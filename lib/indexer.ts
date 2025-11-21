import { v4 as uuidv4 } from 'uuid';
import path from 'path';

import { processFile, getFileHash, getAllFiles } from './files';
import { generateEmbedding } from './ai';
import { qdrantClient, COLLECTION_NAME, ensureCollection } from './qdrant';
import prisma from './prisma';
import { config } from './config';

export async function indexFile(filePath: string) {
    try {
        console.log(`Indexing file: ${filePath}`);

        // 1. Check if file needs indexing (hash check)
        const currentHash = await getFileHash(filePath);
        const existingRecord = await prisma.indexedFile.findUnique({
            where: { filePath },
        });

        if (existingRecord && existingRecord.fileHash === currentHash && existingRecord.status === 'indexed') {
            console.log(`File ${filePath} is already up to date.`);
            return;
        }

        // 2. Process file into chunks
        const chunks = await processFile(filePath);
        console.log(`Generated ${chunks.length} chunks for ${filePath}`);

        // 3. Generate embeddings
        const points = [];
        for (const chunk of chunks) {
            const embedding = await generateEmbedding(chunk.content);

            points.push({
                id: uuidv4(),
                vector: embedding,
                payload: {
                    content: chunk.content,
                    // chunk.metadata already contains filePath, fileName, etc.
                    ...chunk.metadata,
                },
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
                        key: 'filePath',
                        match: {
                            value: filePath,
                        },
                    },
                ],
            },
        });

        // Upsert new points
        if (points.length > 0) {
            console.log(`Generated ${points.length} points. Upserting to Qdrant via fetch...`);
            try {
                const response = await fetch(`${config.QDRANT_URL}/collections/${COLLECTION_NAME}/points?wait=true`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ points }),
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Qdrant upsert failed: ${response.status} ${response.statusText} - ${errText}`);
                }

                const result = await response.json();
                // console.log('✅ Upsert result:', JSON.stringify(result));
            } catch (upErr) {
                console.error('❌ Upsert failed for file', filePath, upErr);
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
                status: 'indexed',
            },
            create: {
                filePath,
                fileHash: currentHash,
                lastModified: new Date(),
                chunkCount: chunks.length,
                status: 'indexed',
            },
        });

        console.log(`Successfully indexed ${filePath}`);
    } catch (error) {
        console.error(`Error indexing ${filePath}:`, error);
        // Update status to error
        await prisma.indexedFile.upsert({
            where: { filePath },
            update: { status: 'error' },
            create: {
                filePath,
                fileHash: 'error',
                lastModified: new Date(),
                chunkCount: 0,
                status: 'error',
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
                        key: 'filePath',
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
    console.log('Starting full scan...');
    const allFiles = await getAllFiles(config.DOCUMENTS_FOLDER_PATH);

    // 1. Index all existing files
    let indexedCount = 0;
    for (const filePath of allFiles) {
        try {
            console.log(`Indexing file ${filePath}...`);
            await indexFile(filePath);
            console.log(`✅ Indexed ${filePath}`);
            indexedCount++;
        } catch (error) {
            console.error(`Failed to index ${filePath} during scan:`, error);
        }
    }

    // 2. Remove deleted files
    const dbFiles = await prisma.indexedFile.findMany({
        select: { filePath: true },
    });

    let deletedCount = 0;
    for (const dbFile of dbFiles) {
        if (!allFiles.includes(dbFile.filePath)) {
            try {
                await deleteFileIndex(dbFile.filePath);
                deletedCount++;
            } catch (error) {
                console.error(`Failed to delete index for ${dbFile.filePath} during scan:`, error);
            }
        }
    }

    console.log(`Scan complete. Indexed: ${indexedCount}, Deleted: ${deletedCount}`);
    return { indexedCount, deletedCount };
}
