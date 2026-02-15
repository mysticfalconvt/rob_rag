import { generateEmbedding } from "./ai";
import { config } from "./config";
import {
  getAllFiles,
  getFileHash,
  processFile,
  processPaperlessDocument,
} from "./files";
import type { PaperlessDocument, PaperlessDocumentMetadata } from "./paperless";
import prisma from "./prisma";

export async function indexFile(filePath: string, uploadedBy?: string) {
  try {
    console.log(`Indexing file: ${filePath}`);

    // 1. Check if file needs indexing (hash check)
    const currentHash = await getFileHash(filePath);
    const existingRecord = await prisma.indexedFile.findUnique({
      where: { filePath },
    });

    if (
      existingRecord &&
      existingRecord.fileHash === currentHash &&
      existingRecord.status === "indexed"
    ) {
      console.log(`File ${filePath} is already up to date.`);
      return;
    }

    // 2. Process file into chunks
    const chunks = await processFile(filePath);
    console.log(`Generated ${chunks.length} chunks for ${filePath}`);

    // 3. Determine file source based on path
    const isUploaded = filePath.includes("/File Uploads/");
    const isNote = filePath.includes("/Notes/");
    const source = isUploaded ? "uploaded" : isNote ? "user_note" : "synced";

    // 4. Delete old chunks for this file if they exist
    await prisma.documentChunk.deleteMany({
      where: { filePath },
    });

    // 5. Get tags for this document to include in embeddings
    let documentTags: string[] = [];
    const fileRecord = await prisma.indexedFile.findUnique({
      where: { filePath },
      include: {
        documentTags: {
          include: { tag: true },
        },
      },
    });
    if (fileRecord?.documentTags) {
      documentTags = fileRecord.documentTags.map((dt) => dt.tag.name);
    }

    // 5. Generate embeddings and create DocumentChunks
    let chunksCreated = 0;
    const { v4: uuidv4 } = await import("uuid");

    for (const chunk of chunks) {
      // Skip if content is empty or too large
      if (!chunk.content || chunk.content.length === 0) {
        console.warn(`Skipping empty chunk for ${filePath}`);
        continue;
      }
      if (chunk.content.length > 100000) {
        console.warn(`Skipping oversized chunk for ${filePath}`);
        continue;
      }

      // Append tags to content for embedding if tags exist
      let contentWithTags = chunk.content;
      if (documentTags.length > 0) {
        contentWithTags = `${chunk.content}\n\nTags: ${documentTags.join(", ")}`;
      }

      const embedding = await generateEmbedding(contentWithTags);
      const chunkId = uuidv4();
      const embeddingStr = `[${embedding.join(",")}]`;

      // Create DocumentChunk with pgvector embedding using raw SQL
      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" (
          id, content, embedding, source, "fileName", "filePath", "fileType",
          "chunkIndex", "totalChunks", "embeddingVersion", "lastEmbedded",
          "createdAt", "updatedAt"
        ) VALUES (
          ${chunkId}, ${chunk.content}, ${embeddingStr}::vector, ${source},
          ${chunk.metadata.fileName}, ${chunk.metadata.filePath}, ${chunk.metadata.fileType},
          ${chunk.metadata.chunkIndex}, ${chunk.metadata.totalChunks}, ${1}, NOW(), NOW(), NOW()
        )
      `;
      chunksCreated++;
    }

    console.log(`Created ${chunksCreated} chunks in PostgreSQL`);

    // 6. Update IndexedFile
    await prisma.indexedFile.upsert({
      where: { filePath },
      update: {
        fileHash: currentHash,
        lastModified: new Date(), // Ideally get from fs.stat
        lastIndexed: new Date(),
        chunkCount: chunks.length,
        status: "indexed",
        source,
        ...(uploadedBy && { uploadedBy }),
      },
      create: {
        filePath,
        fileHash: currentHash,
        lastModified: new Date(),
        chunkCount: chunks.length,
        status: "indexed",
        source,
        ...(uploadedBy && { uploadedBy }),
      },
    });

    console.log(`Successfully indexed ${filePath}`);
  } catch (error) {
    console.error(`Error indexing ${filePath}:`, error);
    // Update status to error
    await prisma.indexedFile.upsert({
      where: { filePath },
      update: { status: "error" },
      create: {
        filePath,
        fileHash: "error",
        lastModified: new Date(),
        chunkCount: 0,
        status: "error",
      },
    });
    throw error;
  }
}

export async function deleteFileIndex(filePath: string) {
  try {
    console.log(`Deleting index for: ${filePath}`);

    // Delete DocumentChunks (cascades from IndexedFile if linked)
    await prisma.documentChunk.deleteMany({
      where: { filePath },
    });

    // Delete from IndexedFile
    await prisma.indexedFile.delete({
      where: { filePath },
    });

    console.log(`Successfully deleted index for ${filePath}`);
  } catch (error) {
    console.error(`Error deleting index for ${filePath}:`, error);
    throw error;
  }
}

export async function scanAllFiles() {
  console.log("Starting full scan...");

  // 1. Scan local files
  const allFiles = await getAllFiles(config.DOCUMENTS_FOLDER_PATH);

  let localIndexed = 0;
  for (const filePath of allFiles) {
    try {
      console.log(`Indexing file ${filePath}...`);
      await indexFile(filePath);
      console.log(`✅ Indexed ${filePath}`);
      localIndexed++;
    } catch (error) {
      console.error(`Failed to index ${filePath} during scan:`, error);
    }
  }

  // 2. Remove deleted local files
  const dbFiles = await prisma.indexedFile.findMany({
    where: { source: "local" },
    select: { filePath: true },
  });

  let localDeleted = 0;
  for (const dbFile of dbFiles) {
    if (!allFiles.includes(dbFile.filePath)) {
      try {
        await deleteFileIndex(dbFile.filePath);
        localDeleted++;
      } catch (error) {
        console.error(
          `Failed to delete index for ${dbFile.filePath} during scan:`,
          error,
        );
      }
    }
  }

  console.log(
    `Local scan complete. Indexed: ${localIndexed}, Deleted: ${localDeleted}`,
  );

  // 3. Scan Paperless-ngx documents
  let paperlessIndexed = 0;
  let paperlessDeleted = 0;

  try {
    const paperlessResult = await scanPaperlessDocuments();
    paperlessIndexed = paperlessResult.indexedCount;
    paperlessDeleted = paperlessResult.deletedCount;
  } catch (error) {
    console.error("Paperless-ngx scan failed:", error);
  }

  console.log(
    `Full scan complete. Local: ${localIndexed}/${localDeleted}, Paperless: ${paperlessIndexed}/${paperlessDeleted}`,
  );
  return {
    localIndexed,
    localDeleted,
    paperlessIndexed,
    paperlessDeleted,
  };
}

export async function indexPaperlessDocument(
  doc: PaperlessDocument,
  metadata: PaperlessDocumentMetadata,
) {
  const filePath = `paperless://${doc.id}`;

  try {
    console.log(
      `Indexing Paperless document: ${metadata.title} (ID: ${doc.id})`,
    );

    // 1. Create hash from content and modified date
    const crypto = require("node:crypto");
    const currentHash = crypto
      .createHash("sha256")
      .update(doc.content + doc.modified)
      .digest("hex");

    const existingRecord = await prisma.indexedFile.findUnique({
      where: { filePath },
    });

    if (
      existingRecord &&
      existingRecord.fileHash === currentHash &&
      existingRecord.status === "indexed"
    ) {
      console.log(`Paperless document ${doc.id} is already up to date.`);
      return;
    }

    // 2. Process document into chunks
    const chunks = await processPaperlessDocument(doc.content, metadata);
    console.log(
      `Generated ${chunks.length} chunks for Paperless document ${doc.id}`,
    );

    // 3. Delete old chunks for this document if they exist
    await prisma.documentChunk.deleteMany({
      where: { filePath },
    });

    // 4. Get tags for this document to include in embeddings
    let documentTags: string[] = [];
    const fileRecord = await prisma.indexedFile.findUnique({
      where: { filePath },
      include: {
        documentTags: {
          include: { tag: true },
        },
      },
    });
    if (fileRecord?.documentTags) {
      documentTags = fileRecord.documentTags.map((dt) => dt.tag.name);
    }

    // 4. Generate embeddings and create DocumentChunks
    let chunksCreated = 0;
    const { v4: uuidv4 } = await import("uuid");

    for (const chunk of chunks) {
      // Skip if content is empty or too large
      if (!chunk.content || chunk.content.length === 0) {
        console.warn(`Skipping empty chunk for Paperless doc ${doc.id}`);
        continue;
      }
      if (chunk.content.length > 100000) {
        console.warn(`Skipping oversized chunk for Paperless doc ${doc.id}`);
        continue;
      }

      // Append tags to content for embedding if tags exist
      let contentWithTags = chunk.content;
      if (documentTags.length > 0) {
        contentWithTags = `${chunk.content}\n\nTags: ${documentTags.join(", ")}`;
      }

      const embedding = await generateEmbedding(contentWithTags);
      const chunkId = uuidv4();
      const embeddingStr = `[${embedding.join(",")}]`;

      // Create DocumentChunk with pgvector embedding using raw SQL
      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" (
          id, content, embedding, source, "fileName", "filePath", "fileType",
          "chunkIndex", "totalChunks", "paperlessId", "paperlessTitle",
          "paperlessTags", "paperlessCorrespondent", "documentDate",
          "embeddingVersion", "lastEmbedded", "createdAt", "updatedAt"
        ) VALUES (
          ${chunkId}, ${chunk.content}, ${embeddingStr}::vector, ${"paperless"},
          ${chunk.metadata.fileName}, ${chunk.metadata.filePath}, ${chunk.metadata.fileType},
          ${chunk.metadata.chunkIndex}, ${chunk.metadata.totalChunks},
          ${chunk.metadata.paperlessId}, ${metadata.title},
          ${chunk.metadata.paperlessTags}, ${chunk.metadata.paperlessCorrespondent},
          ${chunk.metadata.paperlessCreated}, ${1}, NOW(), NOW(), NOW()
        )
      `;
      chunksCreated++;
    }

    console.log(`Created ${chunksCreated} chunks in PostgreSQL`);

    // 5. Update IndexedFile
    await prisma.indexedFile.upsert({
      where: { filePath },
      update: {
        fileHash: currentHash,
        lastModified: metadata.modified,
        lastIndexed: new Date(),
        chunkCount: chunks.length,
        status: "indexed",
        source: "paperless",
        paperlessId: metadata.id,
        paperlessTitle: metadata.title,
        paperlessTags: JSON.stringify(metadata.tags),
        paperlessCorrespondent: metadata.correspondent,
      },
      create: {
        filePath,
        fileHash: currentHash,
        lastModified: metadata.modified,
        chunkCount: chunks.length,
        status: "indexed",
        source: "paperless",
        paperlessId: metadata.id,
        paperlessTitle: metadata.title,
        paperlessTags: JSON.stringify(metadata.tags),
        paperlessCorrespondent: metadata.correspondent,
      },
    });

    console.log(`Successfully indexed Paperless document ${doc.id}`);
  } catch (error) {
    console.error(`Error indexing Paperless document ${doc.id}:`, error);
    // Update status to error
    await prisma.indexedFile.upsert({
      where: { filePath },
      update: { status: "error" },
      create: {
        filePath,
        fileHash: "error",
        lastModified: new Date(),
        chunkCount: 0,
        status: "error",
        source: "paperless",
        paperlessId: doc.id,
        paperlessTitle: metadata.title,
      },
    });
    throw error;
  }
}

export async function scanPaperlessDocuments() {
  console.log("Starting Paperless-ngx scan...");

  try {
    // Get Paperless client
    const { getPaperlessClient } = await import("./paperless");
    const client = await getPaperlessClient();

    if (!client) {
      console.log("Paperless-ngx not configured or not enabled. Skipping.");
      return { indexedCount: 0, deletedCount: 0 };
    }

    // Fetch all documents
    const documents = await client.getAllDocuments();
    console.log(`Found ${documents.length} documents in Paperless-ngx`);

    // Index each document
    let indexedCount = 0;
    for (const doc of documents) {
      try {
        // Check if this document is using custom OCR
        const filePath = `paperless://${doc.id}`;
        const existingFile = await prisma.indexedFile.findUnique({
          where: { filePath },
        });

        // Skip if using custom OCR (will be indexed separately)
        if (existingFile?.useCustomOcr && existingFile?.sourceOverride === "custom_ocr") {
          console.log(`Skipping ${doc.id} - using custom OCR`);
          continue;
        }

        const metadata = await client.getDocumentMetadata(doc.id);
        const content = await client.getDocumentContent(doc.id);

        await indexPaperlessDocument({ ...doc, content }, metadata);
        indexedCount++;
      } catch (error) {
        console.error(`Failed to index Paperless document ${doc.id}:`, error);
        // Continue with other documents
      }
    }

    // Find deleted documents (in DB but not in Paperless-ngx)
    const dbDocs = await prisma.indexedFile.findMany({
      where: { source: "paperless" },
      select: { filePath: true, paperlessId: true, useCustomOcr: true },
    });

    const paperlessIds = new Set(documents.map((d) => d.id));
    let deletedCount = 0;

    for (const dbDoc of dbDocs) {
      if (dbDoc.paperlessId && !paperlessIds.has(dbDoc.paperlessId)) {
        // Only delete if not using custom OCR (custom OCR docs are independent)
        if (!dbDoc.useCustomOcr) {
          try {
            await deleteFileIndex(dbDoc.filePath);
            deletedCount++;
          } catch (error) {
            console.error(
              `Failed to delete index for Paperless document ${dbDoc.paperlessId}:`,
              error,
            );
          }
        }
      }
    }

    // Clear cache after scan
    client.clearCache();

    console.log(
      `Paperless-ngx scan complete. Indexed: ${indexedCount}, Deleted: ${deletedCount}`,
    );
    return { indexedCount, deletedCount };
  } catch (error) {
    console.error("Error during Paperless-ngx scan:", error);
    return { indexedCount: 0, deletedCount: 0 };
  }
}

/**
 * Index a document that has been processed with custom OCR
 */
export async function indexCustomOcrDocument(
  paperlessId: number,
  ocrResult: { markdown: string; summary: string; metadata: any },
) {
  const filePath = `paperless://${paperlessId}`;

  try {
    console.log(`Indexing custom OCR document: ${paperlessId}`);

    // Get file record with paths
    const fileRecord = await prisma.indexedFile.findUnique({
      where: { filePath },
    });

    if (!fileRecord?.ocrOutputPath) {
      throw new Error("OCR output path not found");
    }

    // Create hash from markdown content
    const crypto = require("node:crypto");
    const currentHash = crypto
      .createHash("sha256")
      .update(ocrResult.markdown)
      .digest("hex");

    // Delete old chunks for this document
    await prisma.documentChunk.deleteMany({
      where: { filePath },
    });

    // Create splitter for content chunks
    const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800,
      chunkOverlap: 200,
    });

    const contentChunks = await splitter.createDocuments([ocrResult.markdown]);

    // Get tags for this document to include in embeddings
    let documentTags: string[] = [];
    const fileRecordWithTags = await prisma.indexedFile.findUnique({
      where: { filePath },
      include: {
        documentTags: {
          include: { tag: true },
        },
      },
    });
    if (fileRecordWithTags?.documentTags) {
      documentTags = fileRecordWithTags.documentTags.map((dt) => dt.tag.name);
    }

    // Get the document title from the file record
    const documentTitle = fileRecordWithTags?.paperlessTitle || `Document ${paperlessId}`;

    // Calculate total chunks (1 summary + N content)
    const totalChunks = contentChunks.length + 1;
    let chunksCreated = 0;
    const { v4: uuidv4 } = await import("uuid");

    // Create summary chunk (index 0)
    let summaryText = `Document Summary:\n${ocrResult.summary}\n\nExtracted Metadata:\n- Type: ${ocrResult.metadata.documentType || "Unknown"}\n- Date: ${ocrResult.metadata.extractedDate ? new Date(ocrResult.metadata.extractedDate).toISOString().split("T")[0] : "Unknown"}\n- Tags: ${ocrResult.metadata.extractedTags.join(", ")}\n\nFull document available at: ${filePath}`;

    // Append global tags to summary if they exist
    if (documentTags.length > 0) {
      summaryText += `\n\nGlobal Tags: ${documentTags.join(", ")}`;
    }

    const summaryEmbedding = await generateEmbedding(summaryText);
    const summaryChunkId = uuidv4();
    const summaryEmbeddingStr = `[${summaryEmbedding.join(",")}]`;

    await prisma.$executeRaw`
      INSERT INTO "DocumentChunk" (
        id, content, embedding, source, "fileName", "filePath", "fileType",
        "chunkIndex", "totalChunks", "chunkType", "paperlessId",
        "embeddingVersion", "lastEmbedded", "createdAt", "updatedAt"
      ) VALUES (
        ${summaryChunkId}, ${summaryText}, ${summaryEmbeddingStr}::vector,
        ${"custom_ocr"}, ${documentTitle}, ${filePath}, ${"markdown"},
        ${0}, ${totalChunks}, ${"summary"}, ${paperlessId},
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
        console.warn(`Skipping oversized chunk for custom OCR doc ${paperlessId}`);
        continue;
      }

      // Append tags to content for embedding if tags exist
      let contentWithTags = chunk.pageContent;
      if (documentTags.length > 0) {
        contentWithTags = `${chunk.pageContent}\n\nTags: ${documentTags.join(", ")}`;
      }

      const embedding = await generateEmbedding(contentWithTags);
      const chunkId = uuidv4();
      const embeddingStr = `[${embedding.join(",")}]`;

      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" (
          id, content, embedding, source, "fileName", "filePath", "fileType",
          "chunkIndex", "totalChunks", "chunkType", "paperlessId",
          "embeddingVersion", "lastEmbedded", "createdAt", "updatedAt"
        ) VALUES (
          ${chunkId}, ${chunk.pageContent}, ${embeddingStr}::vector,
          ${"custom_ocr"}, ${documentTitle}, ${filePath}, ${"markdown"},
          ${i + 1}, ${totalChunks}, ${"content"}, ${paperlessId},
          ${1}, NOW(), NOW(), NOW()
        )
      `;
      chunksCreated++;
    }

    console.log(`Created ${chunksCreated} chunks (1 summary + ${contentChunks.length} content) in PostgreSQL`);

    // Update IndexedFile
    await prisma.indexedFile.update({
      where: { filePath },
      data: {
        fileHash: currentHash,
        lastIndexed: new Date(),
        chunkCount: chunksCreated,
        status: "indexed",
      },
    });

    console.log(`Successfully indexed custom OCR document ${paperlessId}`);
  } catch (error) {
    console.error(`Error indexing custom OCR document ${paperlessId}:`, error);
    await prisma.indexedFile.update({
      where: { filePath },
      data: {
        status: "error",
        customOcrStatus: "error",
      },
    });
    throw error;
  }
}
