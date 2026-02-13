import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import prisma from "./prisma";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { fromPath } from "pdf2pic";

export interface VisionOcrResult {
  markdown: string;
  metadata: {
    extractedDate?: Date;
    extractedTags: string[];
    documentType?: string;
  };
  summary: string;
}

export interface OcrProcessingJob {
  id: string;
  status: "pending" | "processing" | "completed" | "error";
  progress: number;
  error?: string;
  result?: VisionOcrResult;
}

/**
 * Convert PDF pages to base64 encoded images
 * Returns an array of base64 strings, one per page
 */
export async function pdfToImages(pdfPath: string): Promise<string[]> {
  // Create unique temp directory for this job using timestamp + random string
  const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const outputDir = path.join(path.dirname(pdfPath), `temp_images_${uniqueId}`);

  // Create temp directory for images
  await fs.mkdir(outputDir, { recursive: true });

  try {
    // Configure pdf2pic converter with optimized settings
    const options = {
      density: 120, // Reduced DPI to decrease image size
      saveFilename: "page",
      savePath: outputDir,
      format: "jpg",
      width: 1000, // Further reduced to prevent "failed to process image" errors
      height: 1000, // Further reduced
      quality: 60, // Lower quality = smaller file size
    };

    const converter = fromPath(pdfPath, options);

    // First, try to get info about the PDF to know how many pages
    // pdf2pic returns page info in the conversion result
    const images: string[] = [];

    // Convert pages one by one
    let pageNum = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      try {
        const result = await converter(pageNum, { responseType: "image" });

        if (result && result.path) {
          // Read the generated image
          const imageBuffer = await fs.readFile(result.path);
          images.push(imageBuffer.toString('base64'));
          pageNum++;
        } else {
          hasMorePages = false;
        }
      } catch (err: any) {
        // If we get an error (likely "page doesn't exist"), we're done
        if (pageNum === 1) {
          // If first page fails, throw the error
          throw err;
        }
        hasMorePages = false;
      }
    }

    return images;
  } finally {
    // Clean up temp directory
    try {
      const files = await fs.readdir(outputDir);
      for (const file of files) {
        await fs.unlink(path.join(outputDir, file));
      }
      await fs.rmdir(outputDir);
    } catch (err) {
      console.error('Error cleaning up temp images:', err);
    }
  }
}

/**
 * Read image file and convert to base64
 */
export async function imageToBase64(imagePath: string): Promise<string> {
  const imageBuffer = await fs.readFile(imagePath);
  return imageBuffer.toString("base64");
}

/**
 * Call vision LLM to process document image/page
 */
async function processPageWithVision(
  imageData: string,
  pageNumber: number,
  totalPages: number,
  visionModel: string,
  fileExtension: string,
): Promise<string> {
  const { getActiveConfig } = await import("./config");
  const activeConfig = await getActiveConfig();

  // Build prompt - only request metadata on the last page
  const metadataInstructions = pageNumber === totalPages ? `

THEN, after the content, you MUST add metadata in EXACTLY this format (copy this template):

---
Date: YYYY-MM-DD
Tags: keyword1, keyword2, keyword3
Type: document_type
---

Instructions for metadata:
- Date: Extract any date from the document in YYYY-MM-DD format. If no date found, write "unknown"
- Tags: Generate 3-5 relevant keywords that describe the document's topic or purpose
- Type: Choose the document type (invoice, letter, form, receipt, note, article, etc.)

IMPORTANT: You must include the metadata section with the exact format shown above. Do not skip it.` : '';

  const prompt = `You are reading page ${pageNumber} of ${totalPages} from a scanned document. This image may contain typed text, handwritten notes, tables, or forms.

Generate clean markdown output that preserves:
- All text content exactly as written (including handwritten text)
- Tables in markdown table format
- Headings with appropriate # levels
- Lists and bullet points
- Any important visual elements described in [brackets]
- Add "--- Page ${pageNumber} ---" at the end of the content${metadataInstructions}

Focus on accuracy and completeness. If handwriting is unclear, indicate with [unclear: possible text].`;

  try {
    const requestBody = {
      model: visionModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageData}`,
              },
            },
          ],
        },
      ],
      max_tokens: 4000,
      temperature: 0.1, // Low temperature for accuracy
    };

    console.log(`Sending vision request to model: ${visionModel}`);
    console.log(`Data URL prefix: data:image/jpeg;base64,[${imageData.length} chars]`);

    // Retry logic with exponential backoff
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`${config.LM_STUDIO_API_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.LM_STUDIO_API_KEY && {
              Authorization: `Bearer ${config.LM_STUDIO_API_KEY}`,
            }),
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(120000), // 2 minute timeout
        });

        if (!response.ok) {
          const errorBody = await response.text();

          // If it's a "failed to process image" error, don't retry
          if (errorBody.includes("failed to process image")) {
            console.error(`Vision model cannot process this image (too large or invalid format)`);
            throw new Error(`Image processing failed - image may be too large or corrupted`);
          }

          console.error(`Vision LLM API error details (attempt ${attempt}/${maxRetries}):`, errorBody);

          let errorMsg = `Vision LLM API error: ${response.statusText}`;
          if (errorBody) {
            errorMsg += ` - ${errorBody}`;
          }

          lastError = new Error(errorMsg);

          // Wait before retry (exponential backoff: 2s, 4s, 8s)
          if (attempt < maxRetries) {
            const delayMs = Math.pow(2, attempt) * 1000;
            console.log(`Retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }

          throw lastError;
        }

        // Success - break retry loop
        const result = await response.json();

        if (!result.choices || !result.choices[0] || !result.choices[0].message) {
          console.error('Unexpected API response:', result);
          throw new Error('Invalid response from vision LLM');
        }

        let content = result.choices[0].message.content;

        // Strip markdown code fences if present
        content = content.replace(/^```(?:markdown)?\s*\n/i, '').replace(/\n```\s*$/i, '');

        return content;

      } catch (error: any) {
        lastError = error;

        // If it's a non-retryable error, throw immediately
        if (error.message.includes('Image processing failed') || error.name === 'AbortError') {
          throw error;
        }

        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000;
          console.log(`Request failed (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries failed
    throw lastError || new Error('Vision processing failed after all retries');
  } catch (error) {
    console.error(`Error processing page ${pageNumber}:`, error);
    throw error;
  }
}

/**
 * Extract metadata from the combined markdown output
 */
function extractMetadata(markdown: string): {
  extractedDate?: Date;
  extractedTags: string[];
  documentType?: string;
  cleanMarkdown: string;
} {
  // Try multiple metadata format patterns
  let metadataMatch = markdown.match(/---\s*METADATA:([\s\S]*?)---/);

  // Alternative format without METADATA: label (just --- with Date/Tags/Type inside)
  if (!metadataMatch) {
    metadataMatch = markdown.match(/---\s*\n?(Date:[\s\S]*?)---/);
  }

  // Try even more flexible pattern - just look for the last --- block
  if (!metadataMatch) {
    const lastBlock = markdown.match(/---([^-][\s\S]*?)---\s*$/);
    if (lastBlock && lastBlock[1].includes("Date:")) {
      metadataMatch = lastBlock;
    }
  }

  if (!metadataMatch) {
    console.log("⚠️  No metadata section found in vision model response");
    // Log last 500 chars to help debug (metadata should be at the end)
    console.log("Response end preview:", markdown.substring(Math.max(0, markdown.length - 500)));
    return {
      extractedTags: [],
      cleanMarkdown: markdown,
    };
  }

  const metadataSection = metadataMatch[1] || metadataMatch[0];
  // Remove only the metadata block (last --- block that contains Date:/Tags:/Type:)
  const cleanMarkdown = markdown.replace(/---\s*\n?(Date:[\s\S]*?)---\s*$/, "").trim();

  console.log("Found metadata section:", metadataSection);

  // Extract date - support multiple formats
  let dateMatch = metadataSection.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) {
    // Try other common date formats
    dateMatch = metadataSection.match(/Date:\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
  }
  const extractedDate = dateMatch ? new Date(dateMatch[1]) : undefined;

  // Extract tags
  const tagsMatch = metadataSection.match(/Tags:\s*(.+?)(?:\n|$)/);
  const extractedTags = tagsMatch
    ? tagsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t && t.toLowerCase() !== "unknown")
    : [];

  // Extract type
  const typeMatch = metadataSection.match(/Type:\s*(.+?)(?:\n|$)/);
  const documentType = typeMatch ? typeMatch[1].trim() : undefined;

  return {
    extractedDate,
    extractedTags,
    documentType,
    cleanMarkdown,
  };
}

/**
 * Generate a summary of the document for the summary chunk
 */
async function generateDocumentSummary(
  markdown: string,
  metadata: {
    extractedDate?: Date;
    extractedTags: string[];
    documentType?: string;
  },
): Promise<string> {
  const { getActiveConfig } = await import("./config");
  const activeConfig = await getActiveConfig();

  const prompt = `You are creating a concise summary of this document for retrieval purposes.

Document Type: ${metadata.documentType || "Unknown"}
Date: ${metadata.extractedDate ? metadata.extractedDate.toISOString().split("T")[0] : "Unknown"}
Tags: ${metadata.extractedTags.join(", ")}

Full Document:
${markdown.substring(0, 10000)} ${markdown.length > 10000 ? "..." : ""}

Create a comprehensive but concise summary (300-500 words) that captures:
1. What this document is about
2. Key information, dates, and entities
3. Main topics and themes
4. Any important numbers, amounts, or specifics

This summary will be used for semantic search, so include key terms that someone might search for.`;

  try {
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
        max_tokens: 800,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`Summary generation error: ${response.statusText}`);
    }

    const result = await response.json();
    return result.choices[0].message.content;
  } catch (error) {
    console.error("Error generating summary:", error);
    // Fallback: use first 500 chars of markdown
    return markdown.substring(0, 500) + "...";
  }
}

/**
 * Process a document (PDF or image) with vision LLM
 */
export async function processDocumentWithVision(
  filePath: string,
  visionModel: string,
): Promise<VisionOcrResult> {
  console.log(`Starting vision OCR processing for: ${filePath}`);

  const ext = path.extname(filePath).toLowerCase();
  const isImage = [".png", ".jpg", ".jpeg", ".gif", ".bmp"].includes(ext);
  const isPdf = ext === ".pdf";

  if (!isImage && !isPdf) {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  let pages: string[];

  if (isPdf) {
    // Convert PDF pages to images
    console.log('Converting PDF to images...');
    pages = await pdfToImages(filePath);
    console.log(`PDF converted to ${pages.length} image(s)`);
  } else {
    // For images, just read the single image
    const imageData = await imageToBase64(filePath);
    pages = [imageData];
  }

  console.log(`Processing ${pages.length} page(s)...`);

  // Process each page with vision LLM
  const markdownPages: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    console.log(`Processing page ${i + 1}/${pages.length}...`);
    const pageMarkdown = await processPageWithVision(
      pages[i],
      i + 1,
      pages.length,
      visionModel,
      ext,
    );
    markdownPages.push(pageMarkdown);
  }

  // Combine all pages
  const combinedMarkdown = markdownPages.join("\n\n---\n\n");

  // Extract metadata from the combined output
  const { extractedDate, extractedTags, documentType, cleanMarkdown } =
    extractMetadata(combinedMarkdown);

  console.log(
    `Extracted metadata - Date: ${extractedDate}, Tags: ${extractedTags.join(", ")}, Type: ${documentType}`,
  );

  // Generate summary
  console.log("Generating document summary...");
  const summary = await generateDocumentSummary(cleanMarkdown, {
    extractedDate,
    extractedTags,
    documentType,
  });

  return {
    markdown: cleanMarkdown,
    metadata: {
      extractedDate,
      extractedTags,
      documentType,
    },
    summary,
  };
}

/**
 * Start an OCR processing job for a paperless document
 * Jobs are queued and processed with concurrency control
 */
export async function startOcrJob(
  paperlessId: number,
  visionModel: string,
): Promise<string> {
  const { v4: uuidv4 } = await import("uuid");
  const jobId = uuidv4();

  // Create job in database
  await prisma.ocrJob.create({
    data: {
      id: jobId,
      paperlessId,
      visionModel,
      status: "pending",
      progress: 0,
    },
  });

  // Add to queue instead of starting immediately
  const { ocrQueue } = await import("./ocrQueue");
  ocrQueue.enqueue(jobId, paperlessId, visionModel);

  return jobId;
}

/**
 * Helper to update OCR job progress
 */
async function updateJobProgress(jobId: string, progress: number): Promise<void> {
  try {
    await prisma.ocrJob.update({
      where: { id: jobId },
      data: { progress },
    });
  } catch (e) {
    console.error(`Failed to update job ${jobId} progress:`, e);
  }
}

/**
 * Process OCR job asynchronously
 */
export async function processOcrJobAsync(
  jobId: string,
  paperlessId: number,
  visionModel: string,
): Promise<void> {
  try {
    // Update job status to processing
    await prisma.ocrJob.update({
      where: { id: jobId },
      data: {
        status: "processing",
        startedAt: new Date(),
        progress: 10,
      },
    });

    // Get paperless client and download document
    const { getPaperlessClient } = await import("./paperless");
    const client = await getPaperlessClient();
    if (!client) {
      throw new Error("Paperless client not configured");
    }

    await updateJobProgress(jobId, 20);

    // Download the document
    const url = `${client["config"].url}/api/documents/${paperlessId}/download/`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Token ${client["config"].apiToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download document: ${response.statusText}`);
    }

    await updateJobProgress(jobId, 30);

    // Save to originals folder
    const customDocsPath = path.join(
      config.DOCUMENTS_FOLDER_PATH,
      "Custom_Docs",
    );
    const originalsPath = path.join(customDocsPath, "originals");
    const markdownPath = path.join(customDocsPath, "markdown");

    // Create directories if they don't exist
    await fs.mkdir(originalsPath, { recursive: true });
    await fs.mkdir(markdownPath, { recursive: true });

    const buffer = Buffer.from(await response.arrayBuffer());
    const originalFilePath = path.join(originalsPath, `${paperlessId}.pdf`);
    await fs.writeFile(originalFilePath, buffer);

    await updateJobProgress(jobId, 40);

    // Process with vision LLM
    const result = await processDocumentWithVision(
      originalFilePath,
      visionModel,
    );

    await updateJobProgress(jobId, 70);

    // Save markdown output
    const markdownFilePath = path.join(markdownPath, `${paperlessId}.md`);
    await fs.writeFile(markdownFilePath, result.markdown);

    await updateJobProgress(jobId, 80);

    // Update tags in Paperless-ngx with extracted tags
    if (result.metadata.extractedTags.length > 0) {
      try {
        // First, get or create tags in Paperless
        const tagIds: number[] = [];
        for (const tagName of result.metadata.extractedTags) {
          // Try to find existing tag
          const tagsResponse = await fetch(
            `${client["config"].url}/api/tags/?name=${encodeURIComponent(tagName)}`,
            {
              headers: {
                Authorization: `Token ${client["config"].apiToken}`,
              },
            },
          );

          if (tagsResponse.ok) {
            const tagsData = await tagsResponse.json();
            if (tagsData.results && tagsData.results.length > 0) {
              // Tag exists
              tagIds.push(tagsData.results[0].id);
            } else {
              // Create new tag
              const createTagResponse = await fetch(
                `${client["config"].url}/api/tags/`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Token ${client["config"].apiToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    name: tagName,
                    color: "#a6cee3", // Light blue color for auto-generated tags
                  }),
                },
              );

              if (createTagResponse.ok) {
                const newTag = await createTagResponse.json();
                tagIds.push(newTag.id);
              }
            }
          }
        }

        // Update document with new tags
        if (tagIds.length > 0) {
          await fetch(`${client["config"].url}/api/documents/${paperlessId}/`, {
            method: "PATCH",
            headers: {
              Authorization: `Token ${client["config"].apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tags: tagIds,
            }),
          });

          console.log(`Updated Paperless document ${paperlessId} with tags:`, result.metadata.extractedTags);
        }
      } catch (error) {
        console.error("Error updating Paperless tags:", error);
        // Don't fail the whole job if tag update fails
      }
    }

    // Update database
    const filePath = `paperless://${paperlessId}`;
    await prisma.indexedFile.update({
      where: { filePath },
      data: {
        useCustomOcr: true,
        customOcrStatus: "completed",
        originalDocPath: originalFilePath,
        ocrOutputPath: markdownFilePath,
        extractedDate: result.metadata.extractedDate,
        extractedTags: result.metadata.extractedTags.join("|"),
        documentType: result.metadata.documentType,
        documentSummary: result.summary,
        source: "custom_ocr", // Change source to custom_ocr
        sourceOverride: "custom_ocr",
      },
    });

    await updateJobProgress(jobId, 90);

    // Trigger re-indexing with the new markdown
    const { indexCustomOcrDocument } = await import("./indexer");
    await indexCustomOcrDocument(paperlessId, result);

    await updateJobProgress(jobId, 95);

    // Auto-tag the document with our global tag system using smart tag generation
    try {
      // Get the indexed file
      const indexedFile = await prisma.indexedFile.findUnique({
        where: { filePath },
      });

      if (indexedFile) {
        // Get approved tags and user names for context
        const approvedTags = await prisma.tag.findMany({
          where: { status: "approved" },
          select: { name: true },
        });
        const approvedTagNames = approvedTags.map((t) => t.name).join(", ");

        const users = await prisma.authUser.findMany({
          select: { name: true },
        });
        const userNames = users.map((u) => u.name).join(", ");

        // Use the document content/summary for tag generation
        const textForTagging =
          result.markdown.length > 10000
            ? result.summary
            : result.markdown;

        // Generate tags with LLM using our smart prompt
        const { getActiveConfig } = await import("./config");
        const activeConfig = await getActiveConfig();

        const prompt = `You are generating tags for a document. Tags should be concise, relevant keywords that describe the content.

${approvedTagNames ? `EXISTING APPROVED TAGS IN THE SYSTEM (STRONGLY PREFER THESE):\n${approvedTagNames}\n\n` : ""}${userNames ? `PEOPLE/USERS IN THE SYSTEM (use these tags if the document mentions these people):\n${userNames}\n\n` : ""}Document content:
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

        if (response.ok) {
          const llmResult = await response.json();
          const llmResponse = llmResult.choices[0].message.content;

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
            // Fallback to extracted tags from OCR
            suggestedTags = result.metadata.extractedTags;
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
                  fileId: indexedFile.id,
                  tagId: tag.id,
                },
              },
              update: {},
              create: {
                fileId: indexedFile.id,
                tagId: tag.id,
              },
            });
          }

          console.log(
            `Auto-tagged document ${paperlessId} with ${suggestedTags.length} smart tags`,
          );
        }
      }
    } catch (error) {
      console.error("Error auto-tagging document:", error);
      // Don't fail the whole job if tagging fails
    }

    // Mark job as completed
    await prisma.ocrJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        progress: 100,
        completedAt: new Date(),
      },
    });

    console.log(`OCR job ${jobId} completed successfully`);
  } catch (error: any) {
    console.error(`OCR job ${jobId} failed:`, error);

    // Update job status in database
    await prisma.ocrJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: error.message,
      },
    });

    // Update file status
    const filePath = `paperless://${paperlessId}`;
    await prisma.indexedFile.update({
      where: { filePath },
      data: {
        customOcrStatus: "error",
      },
    });
  }
}

/**
 * Get OCR job status
 */
export async function getOcrJobStatus(jobId: string): Promise<OcrProcessingJob | null> {
  try {
    const job = await prisma.ocrJob.findUnique({
      where: { id: jobId },
    });

    if (!job) return null;

    return {
      id: job.id,
      status: job.status as "pending" | "processing" | "completed" | "error",
      progress: job.progress,
      error: job.error || undefined,
    };
  } catch (e) {
    console.error(`Failed to get job status for ${jobId}:`, e);
    return null;
  }
}

/**
 * Clean up old completed jobs (call periodically)
 */
export async function cleanupOldJobs(maxAgeMs: number = 3600000): Promise<void> {
  try {
    const cutoffDate = new Date(Date.now() - maxAgeMs);

    // Delete old completed or failed jobs
    await prisma.ocrJob.deleteMany({
      where: {
        AND: [
          {
            OR: [
              { status: "completed" },
              { status: "failed" },
            ],
          },
          {
            createdAt: {
              lt: cutoffDate,
            },
          },
        ],
      },
    });

    console.log(`Cleaned up OCR jobs older than ${maxAgeMs}ms`);
  } catch (e) {
    console.error("Failed to cleanup old OCR jobs:", e);
  }
}
