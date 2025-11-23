import { v4 as uuidv4 } from "uuid";
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
import { COLLECTION_NAME, ensureCollection, qdrantClient } from "./qdrant";

export async function indexFile(filePath: string) {
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

    // 3. Generate embeddings
    const points = [];
    // Determine if this is an uploaded file or synced file
    const isUploaded = filePath.includes("/File Uploads/");
    const source = isUploaded ? "uploaded" : "synced";

    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk.content);

      // Validate and sanitize payload
      const payload = {
        content: chunk.content || "",
        filePath: chunk.metadata.filePath,
        fileName: chunk.metadata.fileName,
        fileType: chunk.metadata.fileType,
        parentFolder: chunk.metadata.parentFolder,
        chunkIndex: chunk.metadata.chunkIndex,
        totalChunks: chunk.metadata.totalChunks,
        fileHash: chunk.metadata.fileHash,
        source,
      };

      // Skip if content is empty or too large
      if (!payload.content || payload.content.length === 0) {
        console.warn(`Skipping empty chunk for ${filePath}`);
        continue;
      }
      if (payload.content.length > 100000) {
        console.warn(`Skipping oversized chunk for ${filePath}`);
        continue;
      }

      points.push({
        id: uuidv4(),
        vector: embedding,
        payload,
      });
    }

    // 4. Store in Qdrant
    await ensureCollection();

    // Delete old points for this file if they exist
    // We can delete by filter on filePath
    await qdrantClient.delete(COLLECTION_NAME, {
      filter: {
        must: [
          {
            key: "filePath",
            match: {
              value: filePath,
            },
          },
        ],
      },
    });

    // Upsert new points
    if (points.length > 0) {
      console.log(
        `Generated ${points.length} points. Upserting to Qdrant via fetch...`,
      );
      try {
        const response = await fetch(
          `${config.QDRANT_URL}/collections/${COLLECTION_NAME}/points?wait=true`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ points }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(
            `Qdrant upsert failed: ${response.status} ${response.statusText} - ${errText}`,
          );
        }

        const _result = await response.json();
        // console.log('✅ Upsert result:', JSON.stringify(result));
      } catch (upErr) {
        console.error("❌ Upsert failed for file", filePath, upErr);
        throw upErr;
      }
    } else {
      console.warn(`No points generated for ${filePath}`);
    }

    // 5. Update SQLite
    await prisma.indexedFile.upsert({
      where: { filePath },
      update: {
        fileHash: currentHash,
        lastModified: new Date(), // Ideally get from fs.stat
        lastIndexed: new Date(),
        chunkCount: chunks.length,
        status: "indexed",
        source,
      },
      create: {
        filePath,
        fileHash: currentHash,
        lastModified: new Date(),
        chunkCount: chunks.length,
        status: "indexed",
        source,
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

    // Delete from Qdrant
    await qdrantClient.delete(COLLECTION_NAME, {
      filter: {
        must: [
          {
            key: "filePath",
            match: {
              value: filePath,
            },
          },
        ],
      },
    });

    // Delete from SQLite
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

    // 3. Generate embeddings
    const points = [];
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk.content);

      // Validate and sanitize payload
      const payload = {
        content: chunk.content || "",
        filePath: chunk.metadata.filePath,
        fileName: chunk.metadata.fileName,
        fileType: chunk.metadata.fileType,
        parentFolder: chunk.metadata.parentFolder,
        chunkIndex: chunk.metadata.chunkIndex,
        totalChunks: chunk.metadata.totalChunks,
        fileHash: chunk.metadata.fileHash,
        source: chunk.metadata.source,
        paperlessId: chunk.metadata.paperlessId,
        paperlessTags: Array.isArray(chunk.metadata.paperlessTags)
          ? chunk.metadata.paperlessTags.join(",")
          : "",
        paperlessCorrespondent: chunk.metadata.paperlessCorrespondent || "",
        paperlessCreated: chunk.metadata.paperlessCreated || "",
        paperlessModified: chunk.metadata.paperlessModified || "",
      };

      // Skip if content is empty or too large
      if (!payload.content || payload.content.length === 0) {
        console.warn(`Skipping empty chunk for Paperless doc ${doc.id}`);
        continue;
      }
      if (payload.content.length > 100000) {
        console.warn(`Skipping oversized chunk for Paperless doc ${doc.id}`);
        continue;
      }

      points.push({
        id: uuidv4(),
        vector: embedding,
        payload,
      });
    }

    // 4. Store in Qdrant
    await ensureCollection();

    // Delete old points for this document if they exist
    await qdrantClient.delete(COLLECTION_NAME, {
      filter: {
        must: [
          {
            key: "filePath",
            match: {
              value: filePath,
            },
          },
        ],
      },
    });

    // Upsert new points
    if (points.length > 0) {
      console.log(`Generated ${points.length} points. Upserting to Qdrant...`);
      try {
        const response = await fetch(
          `${config.QDRANT_URL}/collections/${COLLECTION_NAME}/points?wait=true`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ points }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(
            `Qdrant upsert failed: ${response.status} ${response.statusText} - ${errText}`,
          );
        }
      } catch (upErr) {
        console.error("❌ Upsert failed for Paperless document", doc.id, upErr);
        throw upErr;
      }
    } else {
      console.warn(`No points generated for Paperless document ${doc.id}`);
    }

    // 5. Update SQLite
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
      select: { filePath: true, paperlessId: true },
    });

    const paperlessIds = new Set(documents.map((d) => d.id));
    let deletedCount = 0;

    for (const dbDoc of dbDocs) {
      if (dbDoc.paperlessId && !paperlessIds.has(dbDoc.paperlessId)) {
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
