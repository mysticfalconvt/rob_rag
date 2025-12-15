import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { indexFile } from "@/lib/indexer";
import { requireAuth } from "@/lib/session";
import { processDocumentWithVision } from "@/lib/visionOcr";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    // Note: File uploads with FormData don't need CSRF protection
    // The browser doesn't auto-send FormData on cross-origin requests
    const session = await requireAuth(req);

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Ensure filename is safe
    const filename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileExt = path.extname(filename).toLowerCase();

    // Determine file type
    const isImage = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(fileExt);
    const isPdf = fileExt === ".pdf";
    const needsOcr = isImage || isPdf;

    if (needsOcr) {
      // Handle PDF/Image with OCR
      const customDocsPath = path.join(config.DOCUMENTS_FOLDER_PATH, "Custom_Docs");
      const originalsPath = path.join(customDocsPath, "originals");
      const markdownPath = path.join(customDocsPath, "markdown");

      // Create directories if they don't exist
      await mkdir(originalsPath, { recursive: true });
      await mkdir(markdownPath, { recursive: true });

      // Save original file
      const originalFilePath = path.join(originalsPath, filename);
      await writeFile(originalFilePath, buffer);
      console.log(`Original file saved to ${originalFilePath} by user ${session.user.id}`);

      // Get vision model from settings
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
      });
      const visionModel = settings?.visionModel;

      if (!visionModel) {
        return NextResponse.json(
          { error: "No vision model configured. Please select a vision model in the Config page." },
          { status: 400 },
        );
      }

      // Process with Vision OCR
      const result = await processDocumentWithVision(originalFilePath, visionModel);

      // Save markdown output
      const baseName = path.basename(filename, fileExt);
      const markdownFilePath = path.join(markdownPath, `${baseName}.md`);
      await writeFile(markdownFilePath, result.markdown);

      // Create a pseudo-path for the uploaded OCR document
      const filePath = `uploaded://${baseName}`;

      // Create or update IndexedFile entry with hash
      const crypto = require("node:crypto");
      const fileHash = crypto
        .createHash("sha256")
        .update(result.markdown)
        .digest("hex");

      const now = new Date();
      await prisma.indexedFile.upsert({
        where: { filePath },
        update: {
          fileHash,
          chunkCount: 0, // Will be updated during indexing
          lastIndexed: now,
          lastModified: now,
          status: "indexed",
          customOcrStatus: "completed",
          originalDocPath: originalFilePath,
          ocrOutputPath: markdownFilePath,
          extractedDate: result.metadata.extractedDate,
          extractedTags: result.metadata.extractedTags.join("|"),
          documentType: result.metadata.documentType,
          documentSummary: result.summary,
          paperlessTitle: baseName, // Use filename as title
        },
        create: {
          filePath,
          fileHash,
          chunkCount: 0, // Will be updated during indexing
          lastIndexed: now,
          lastModified: now,
          status: "indexed",
          source: "custom_ocr",
          useCustomOcr: true,
          customOcrStatus: "completed",
          originalDocPath: originalFilePath,
          ocrOutputPath: markdownFilePath,
          extractedDate: result.metadata.extractedDate,
          extractedTags: result.metadata.extractedTags.join("|"),
          documentType: result.metadata.documentType,
          documentSummary: result.summary,
          uploadedBy: session.user.id,
          paperlessTitle: baseName, // Use filename as title
        },
      });

      // Index the OCR document
      // Delete old chunks for this document (in case of re-upload)
      await prisma.documentChunk.deleteMany({
        where: { filePath },
      });

      // Create splitter for content chunks
      const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 200,
      });

      const contentChunks = await splitter.createDocuments([result.markdown]);

      // Calculate total chunks (1 summary + N content)
      const totalChunks = contentChunks.length + 1;
      let chunksCreated = 0;
      const { v4: uuidv4 } = await import("uuid");
      const { generateEmbedding } = await import("@/lib/ai");

      // Create summary chunk (index 0)
      const summaryText = `Document Summary:\n${result.summary}\n\nExtracted Metadata:\n- Type: ${result.metadata.documentType || "Unknown"}\n- Date: ${result.metadata.extractedDate ? new Date(result.metadata.extractedDate).toISOString().split("T")[0] : "Unknown"}\n- Tags: ${result.metadata.extractedTags.join(", ")}\n\nFull document available at: ${filePath}`;

      const summaryEmbedding = await generateEmbedding(summaryText);
      const summaryChunkId = uuidv4();
      const summaryEmbeddingStr = `[${summaryEmbedding.join(",")}]`;

      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" (
          id, content, embedding, source, "fileName", "filePath", "fileType",
          "chunkIndex", "totalChunks", "chunkType",
          "embeddingVersion", "lastEmbedded", "createdAt", "updatedAt"
        ) VALUES (
          ${summaryChunkId}, ${summaryText}, ${summaryEmbeddingStr}::vector,
          ${"custom_ocr"}, ${baseName}, ${filePath}, ${"markdown"},
          ${0}, ${totalChunks}, ${"summary"},
          ${1}, NOW(), NOW(), NOW()
        )
      `;
      chunksCreated++;

      // Create content chunks (index 1+)
      for (let i = 0; i < contentChunks.length; i++) {
        const chunk = contentChunks[i];

        if (!chunk.pageContent || chunk.pageContent.length === 0) {
          continue;
        }
        if (chunk.pageContent.length > 100000) {
          console.warn(`Skipping oversized chunk for uploaded OCR doc ${baseName}`);
          continue;
        }

        const contentEmbedding = await generateEmbedding(chunk.pageContent);
        const contentChunkId = uuidv4();
        const contentEmbeddingStr = `[${contentEmbedding.join(",")}]`;

        await prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (
            id, content, embedding, source, "fileName", "filePath", "fileType",
            "chunkIndex", "totalChunks", "chunkType",
            "embeddingVersion", "lastEmbedded", "createdAt", "updatedAt"
          ) VALUES (
            ${contentChunkId}, ${chunk.pageContent}, ${contentEmbeddingStr}::vector,
            ${"custom_ocr"}, ${baseName}, ${filePath}, ${"markdown"},
            ${i + 1}, ${totalChunks}, ${"content"},
            ${1}, NOW(), NOW(), NOW()
          )
        `;
        chunksCreated++;
      }

      console.log(`Created ${chunksCreated} chunks for uploaded document ${baseName}`);

      // Update chunk count in IndexedFile
      await prisma.indexedFile.update({
        where: { filePath },
        data: { chunkCount: chunksCreated },
      });

      return NextResponse.json({
        success: true,
        filePath,
        ocrProcessed: true,
        message: "File uploaded and OCR processed successfully"
      });
    } else {
      // Handle regular text files (markdown, txt, etc.)
      const uploadDir = path.join(config.DOCUMENTS_FOLDER_PATH, "File Uploads");
      await mkdir(uploadDir, { recursive: true });

      const filePath = path.join(uploadDir, filename);
      await writeFile(filePath, buffer);
      console.log(`File saved to ${filePath} by user ${session.user.id}`);

      // Index the new file with uploader tracking
      await indexFile(filePath, session.user.id);

      return NextResponse.json({ success: true, filePath });
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
