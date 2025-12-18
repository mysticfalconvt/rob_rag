import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";
import { config } from "@/lib/config";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req);
    const { id: fileId } = await params;

    // Get the document with existing tags
    const file = await prisma.indexedFile.findUnique({
      where: { id: fileId },
      include: {
        documentTags: {
          include: { tag: true },
        },
      },
    });

    if (!file) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    // Get existing tag IDs to filter out later
    const existingTagIds = new Set(file.documentTags.map((dt) => dt.tag.id));

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

    // Get document content
    let content = "";
    let summary = file.documentSummary || "";

    if (file.source === "custom_ocr" && file.ocrOutputPath) {
      const fs = await import("node:fs/promises");
      content = await fs.readFile(file.ocrOutputPath, "utf-8");
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

          // If no content, return error
          if (parts.length === 0) {
            return NextResponse.json(
              { error: "No shelves, review, or notes available to generate tags from" },
              { status: 400 },
            );
          }

          content = `Book: ${book.title} by ${book.author}\n${parts.join("\n")}`;
        }
      }
    } else {
      // Local file
      const fs = await import("node:fs/promises");
      const { readFileContent } = await import("@/lib/files");
      const result = await readFileContent(file.filePath);
      content = result.content;
    }

    // Check if content is empty or too short
    if (!content || content.trim().length < 10) {
      return NextResponse.json(
        { error: "Document content is too short or empty to generate tags" },
        { status: 400 },
      );
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

    const response = await fetch(`${config.LM_STUDIO_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.LM_STUDIO_API_KEY && {
          Authorization: `Bearer ${config.LM_STUDIO_API_KEY}`,
        }),
      },
      body: JSON.stringify({
        model: activeConfig.FAST_CHAT_MODEL_NAME || activeConfig.CHAT_MODEL_NAME,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.statusText}`);
    }

    const result = await response.json();
    const llmResponse = result.choices[0].message.content;

    // Parse the JSON array from the response
    let suggestedTags: string[] = [];
    try {
      // Try to extract JSON array from the response
      const jsonMatch = llmResponse.match(/\[.*\]/s);
      if (jsonMatch) {
        suggestedTags = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: split by commas if not JSON
        suggestedTags = llmResponse
          .split(",")
          .map((t: string) => t.trim().toLowerCase().replace(/['"]/g, ""))
          .filter((t: string) => t.length > 0);
      }
    } catch (error) {
      console.error("Error parsing LLM tags:", error);
      return NextResponse.json(
        { error: "Failed to parse tag suggestions" },
        { status: 500 },
      );
    }

    // For each suggested tag, check if it exists or create as pending
    const tagResults = await Promise.all(
      suggestedTags.map(async (tagName) => {
        const normalized = tagName.toLowerCase().trim();

        // Find or create tag
        let tag = await prisma.tag.findUnique({
          where: { name: normalized },
        });

        const isNew = !tag;

        if (!tag) {
          tag = await prisma.tag.create({
            data: {
              name: normalized,
              status: "pending",
            },
          });
        }

        return {
          id: tag.id,
          name: tag.name,
          status: tag.status,
          isNew,
        };
      }),
    );

    // Filter out tags that are already on the document
    const filteredTagResults = tagResults.filter(
      (tag) => !existingTagIds.has(tag.id),
    );

    return NextResponse.json({
      tags: filteredTagResults,
      message: "Tags generated successfully",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error generating tags:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
