import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";
import { config } from "@/lib/config";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { source, onlyUntagged } = await req.json();

    // Build query for files to tag
    const where: any = {};
    if (source && source !== "all") {
      where.source = source;
    }

    console.log(`Bulk tag generation query: source=${source}, where=`, where);

    // Get files
    let files = await prisma.indexedFile.findMany({
      where,
      include: {
        documentTags: true,
      },
    });

    console.log(`Found ${files.length} files before filtering. Sources:`, [...new Set(files.map(f => f.source))]);

    // Filter to only untagged if requested
    if (onlyUntagged) {
      files = files.filter((f) => f.documentTags.length === 0);
    }

    if (files.length === 0) {
      return NextResponse.json({
        message: "No files to tag",
        totalFiles: 0,
        tagged: 0,
        errors: 0,
      });
    }

    // Get approved tags to provide as context
    const approvedTags = await prisma.tag.findMany({
      where: { status: "approved" },
      select: { name: true },
    });

    const approvedTagNames = approvedTags.map((t) => t.name).join(", ");

    // Get all users to provide as context (their names are also tags)
    const users = await prisma.authUser.findMany({
      select: { name: true, userName: true, userBio: true },
    });
    const userNames = users.map((u) => u.name).join(", ");

    // Get user profile info for context
    const profileContext = users
      .filter((u) => u.userName || u.userBio)
      .map((u) => {
        const parts = [];
        if (u.userName) parts.push(u.userName);
        if (u.userBio) parts.push(u.userBio);
        return parts.join(": ");
      })
      .join("\n");

    // Process files (this will run synchronously, but we could make it async with a job queue)
    let tagged = 0;
    let errors = 0;
    let skipped = 0;
    const results = [];

    for (const file of files) {
      try {
        // Get document content
        let content = "";
        let summary = file.documentSummary || "";

        if (file.source === "custom_ocr" && file.ocrOutputPath) {
          const fs = await import("node:fs/promises");
          try {
            content = await fs.readFile(file.ocrOutputPath, "utf-8");
          } catch (error: any) {
            if (error.code === "ENOENT") {
              console.warn(`Skipping ${file.filePath}: OCR output file not found`);
              skipped++;
              continue;
            }
            throw error;
          }
        } else if (file.source === "paperless" && file.paperlessId) {
          const { getPaperlessClient } = await import("@/lib/paperless");
          const client = await getPaperlessClient();
          if (client) {
            content = await client.getDocumentContent(file.paperlessId);
          }
        } else if (file.source === "goodreads") {
          // Extract from goodreads book
          const bookId = file.filePath.split("/").pop();
          if (bookId) {
            const book = await prisma.goodreadsBook.findUnique({
              where: { id: bookId },
            });
            if (book) {
              // For Goodreads, focus on generating genre/topic tags from:
              // 1. Shelves (already contain genres)
              // 2. Review text (if present)
              // 3. Private notes (if present)
              const parts = [];

              // Extract shelves as potential genres
              if (book.shelves) {
                try {
                  const shelves = JSON.parse(book.shelves);
                  if (shelves.length > 0) {
                    parts.push(`Genres/Shelves: ${shelves.join(", ")}`);
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }

              // Only include review/notes if they exist (for topic extraction)
              if (book.reviewText) {
                parts.push(`Review: ${book.reviewText}`);
              }
              if (book.privateNotes) {
                parts.push(`Notes: ${book.privateNotes}`);
              }

              // If no content (no shelves, review, or notes), skip
              if (parts.length === 0) {
                console.warn(`Skipping ${file.filePath}: No shelves, review, or notes to generate tags from`);
                skipped++;
                continue;
              }

              content = `Book: ${book.title} by ${book.author}\n${parts.join("\n")}`;
              console.log(`Goodreads book content for ${book.title}: ${content.length} chars`);
            } else {
              console.warn(`Skipping ${file.filePath}: Goodreads book not found`);
              skipped++;
              continue;
            }
          } else {
            console.warn(`Skipping ${file.filePath}: Could not extract book ID`);
            skipped++;
            continue;
          }
        } else {
          // Local file
          try {
            const { readFileContent } = await import("@/lib/files");
            const result = await readFileContent(file.filePath);
            content = result.content;
          } catch (error: any) {
            if (error.code === "ENOENT") {
              console.warn(`Skipping ${file.filePath}: File not found on disk`);
              skipped++;
              continue;
            }
            throw error;
          }
        }

        // Check if content is empty or too short
        if (!content || content.trim().length < 10) {
          console.warn(`Skipping ${file.filePath}: Content too short or empty`);
          skipped++;
          continue;
        }

        // If content is large, use summary or truncate
        let textForTagging = content;
        if (content.length > 10000) {
          if (summary) {
            textForTagging = summary;
          } else {
            textForTagging = content.substring(0, 10000);
          }
        }

        // Generate tags with LLM
        const { getActiveConfig } = await import("@/lib/config");
        const activeConfig = await getActiveConfig();

        const prompt = `You are generating tags for a document. Tags should be concise, relevant keywords that describe the content.

${approvedTagNames ? `EXISTING APPROVED TAGS IN THE SYSTEM (STRONGLY PREFER THESE):\n${approvedTagNames}\n\n` : ""}${userNames ? `PEOPLE/USERS IN THE SYSTEM (use these tags if the document mentions these people):\n${userNames}\n\n` : ""}${profileContext ? `USER PROFILE CONTEXT (consider when generating relevant tags):\n${profileContext}\n\n` : ""}Document content:
${textForTagging}

Generate 3-7 relevant tags for this document. IMPORTANT RULES:
- First check if any existing tags match the content (including synonyms - e.g., if "boat" exists, use "boat" not "boating")
- If the document mentions a person whose name appears in the user list above, use their exact name as a tag (lowercase)
- Only create new tags if no existing tags cover the topic
- Each tag should be a single word or short phrase (2-3 words max)
- Use lowercase
- Be descriptive of the content, topic, or category
- Avoid creating near-duplicate tags (e.g., don't create "boating" if "boat" exists)

Return ONLY a JSON array of tag names, like: ["tag1", "tag2", "tag3"]`;

        const response = await fetch(
          `${config.LM_STUDIO_API_URL}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(config.LM_STUDIO_API_KEY && {
                Authorization: `Bearer ${config.LM_STUDIO_API_KEY}`,
              }),
            },
            body: JSON.stringify({
              model:
                activeConfig.FAST_CHAT_MODEL_NAME ||
                activeConfig.CHAT_MODEL_NAME,
              messages: [
                {
                  role: "user",
                  content: prompt,
                },
              ],
              max_tokens: 200,
              temperature: 0.3,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`LLM API error: ${response.statusText}`);
        }

        const result = await response.json();
        const llmResponse = result.choices[0].message.content;

        // Parse the JSON array from the response
        let suggestedTags: string[] = [];
        try {
          const jsonMatch = llmResponse.match(/\[.*\]/s);
          if (jsonMatch) {
            suggestedTags = JSON.parse(jsonMatch[0]);
          } else {
            suggestedTags = llmResponse
              .split(",")
              .map((t: string) => t.trim().toLowerCase().replace(/['"]/g, ""))
              .filter((t: string) => t.length > 0);
          }
        } catch (error) {
          console.error("Error parsing LLM tags:", error);
          errors++;
          continue;
        }

        // For each suggested tag, create or find tag and link to document
        for (const tagName of suggestedTags) {
          const normalized = tagName.toLowerCase().trim();

          // Find or create tag
          let tag = await prisma.tag.findUnique({
            where: { name: normalized },
          });

          if (!tag) {
            tag = await prisma.tag.create({
              data: {
                name: normalized,
                status: "pending",
              },
            });
          }

          // Link tag to document if not already linked
          await prisma.documentTag.upsert({
            where: {
              fileId_tagId: {
                fileId: file.id,
                tagId: tag.id,
              },
            },
            update: {},
            create: {
              fileId: file.id,
              tagId: tag.id,
            },
          });
        }

        tagged++;
        results.push({
          fileId: file.id,
          filePath: file.filePath,
          tags: suggestedTags,
        });
      } catch (error) {
        console.error(`Error tagging file ${file.filePath}:`, error);
        errors++;
      }
    }

    return NextResponse.json({
      message: "Bulk tagging completed",
      totalFiles: files.length,
      tagged,
      skipped,
      errors,
      results,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error in bulk tag generation:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
