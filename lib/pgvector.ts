/**
 * PostgreSQL pgvector utilities
 *
 * Helper functions for working with pgvector embeddings in PostgreSQL
 */

import prisma from './prisma';
import { SearchResult } from './retrieval';

/**
 * Convert a number array embedding to PostgreSQL vector format
 * @param embedding - Array of numbers (e.g., [0.1, 0.2, ...])
 * @returns String in format "[0.1,0.2,...]" for use in SQL
 */
export function embeddingToSql(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Search using pgvector cosine distance
 * @param queryEmbedding - The query vector
 * @param limit - Maximum number of results
 * @param sourceFilter - Optional source filter
 * @returns Array of search results
 */
export async function searchWithPgVector(
  queryEmbedding: number[],
  limit: number = 5,
  sourceFilter?:
    | 'all'
    | 'uploaded'
    | 'synced'
    | 'paperless'
    | 'goodreads'
    | 'none'
    | string[],
): Promise<SearchResult[]> {
  const vectorStr = embeddingToSql(queryEmbedding);

  // Build WHERE clause for source filtering
  let whereClause = '';
  if (sourceFilter && sourceFilter !== 'all' && sourceFilter !== 'none') {
    if (Array.isArray(sourceFilter)) {
      // Multiple sources
      const sources = sourceFilter.map((s) => `'${s}'`).join(',');
      whereClause = `WHERE source IN (${sources})`;
    } else {
      // Single source
      whereClause = `WHERE source = '${sourceFilter}'`;
    }
  }

  try {
    // Use cosine distance operator: <=>
    // Returns 0 for identical vectors, 2 for opposite vectors
    // We convert to similarity score: 1 - (distance / 2) to get 0-1 range
    const results = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        content: string;
        fileName: string;
        filePath: string;
        fileType: string | null;
        source: string;
        distance: number;
        // Optional metadata fields
        userId?: string;
        userName?: string;
        bookTitle?: string;
        bookAuthor?: string;
        userRating?: number;
        dateRead?: string;
        shelves?: string;
        paperlessId?: number;
        paperlessTitle?: string;
        paperlessTags?: string;
        paperlessCorrespondent?: string;
        chunkIndex?: number;
        totalChunks?: number;
      }>
    >(`
      SELECT
        id,
        content,
        "fileName",
        "filePath",
        "fileType",
        source,
        embedding <=> '${vectorStr}'::vector as distance,
        "userId",
        "userName",
        "bookTitle",
        "bookAuthor",
        "userRating",
        "dateRead",
        "shelves",
        "paperlessId",
        "paperlessTitle",
        "paperlessTags",
        "paperlessCorrespondent",
        "chunkIndex",
        "totalChunks"
      FROM "DocumentChunk"
      ${whereClause}
      ORDER BY embedding <=> '${vectorStr}'::vector
      LIMIT ${limit}
    `);

    return results.map((r) => ({
      content: r.content,
      metadata: {
        filePath: r.filePath,
        fileName: r.fileName,
        fileType: r.fileType,
        source: r.source,
        // Include all metadata for context
        userId: r.userId,
        userName: r.userName,
        bookTitle: r.bookTitle,
        bookAuthor: r.bookAuthor,
        userRating: r.userRating,
        dateRead: r.dateRead,
        shelves: r.shelves,
        paperlessId: r.paperlessId,
        paperlessTitle: r.paperlessTitle,
        paperlessTags: r.paperlessTags,
        paperlessCorrespondent: r.paperlessCorrespondent,
        chunkIndex: r.chunkIndex,
        totalChunks: r.totalChunks,
      },
      // Convert cosine distance to similarity score (0-1 range, higher is better)
      score: 1 - r.distance / 2,
    }));
  } catch (error) {
    console.error('[pgvector] Error searching:', error);
    throw error;
  }
}

/**
 * Hybrid search: combine metadata filters with vector similarity
 * This is the key advantage of pgvector - one query for both!
 */
export async function hybridSearch(
  queryEmbedding: number[],
  filters: {
    source?: string | string[];
    minRating?: number;
    maxRating?: number;
    dateStart?: string;
    dateEnd?: string;
    userId?: string;
    author?: string;
  },
  limit: number = 20,
): Promise<SearchResult[]> {
  const vectorStr = embeddingToSql(queryEmbedding);

  // Build WHERE clause dynamically
  const conditions: string[] = [];

  if (filters.source) {
    if (Array.isArray(filters.source)) {
      const sources = filters.source.map((s) => `'${s}'`).join(',');
      conditions.push(`source IN (${sources})`);
    } else {
      conditions.push(`source = '${filters.source}'`);
    }
  }

  if (filters.minRating !== undefined) {
    conditions.push(`"userRating" >= ${filters.minRating}`);
  }

  if (filters.maxRating !== undefined) {
    conditions.push(`"userRating" <= ${filters.maxRating}`);
  }

  if (filters.dateStart) {
    conditions.push(`"dateRead" >= '${filters.dateStart}'`);
  }

  if (filters.dateEnd) {
    conditions.push(`"dateRead" <= '${filters.dateEnd}'`);
  }

  if (filters.userId) {
    conditions.push(`"userId" = '${filters.userId}'`);
  }

  if (filters.author) {
    conditions.push(`"bookAuthor" ILIKE '%${filters.author}%'`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const results = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        content: string;
        fileName: string;
        filePath: string;
        fileType: string | null;
        source: string;
        distance: number;
        userId?: string;
        userName?: string;
        bookTitle?: string;
        bookAuthor?: string;
        userRating?: number;
        dateRead?: string;
        shelves?: string;
        paperlessId?: number;
        paperlessTitle?: string;
        chunkIndex?: number;
        totalChunks?: number;
      }>
    >(`
      SELECT
        id,
        content,
        "fileName",
        "filePath",
        "fileType",
        source,
        embedding <=> '${vectorStr}'::vector as distance,
        "userId",
        "userName",
        "bookTitle",
        "bookAuthor",
        "userRating",
        "dateRead",
        "shelves",
        "paperlessId",
        "paperlessTitle",
        "chunkIndex",
        "totalChunks"
      FROM "DocumentChunk"
      ${whereClause}
      ORDER BY embedding <=> '${vectorStr}'::vector
      LIMIT ${limit}
    `);

    return results.map((r) => ({
      content: r.content,
      metadata: {
        filePath: r.filePath,
        fileName: r.fileName,
        fileType: r.fileType,
        source: r.source,
        userId: r.userId,
        userName: r.userName,
        bookTitle: r.bookTitle,
        bookAuthor: r.bookAuthor,
        userRating: r.userRating,
        dateRead: r.dateRead,
        shelves: r.shelves,
        paperlessId: r.paperlessId,
        paperlessTitle: r.paperlessTitle,
        chunkIndex: r.chunkIndex,
        totalChunks: r.totalChunks,
      },
      score: 1 - r.distance / 2,
    }));
  } catch (error) {
    console.error('[pgvector] Error in hybrid search:', error);
    throw error;
  }
}

/**
 * Count chunks matching filters (for accurate counting in tools)
 */
export async function countChunks(filters: {
  source?: string | string[];
  minRating?: number;
  maxRating?: number;
  dateStart?: string;
  dateEnd?: string;
  userId?: string;
  author?: string;
}): Promise<number> {
  const conditions: string[] = [];

  if (filters.source) {
    if (Array.isArray(filters.source)) {
      const sources = filters.source.map((s) => `'${s}'`).join(',');
      conditions.push(`source IN (${sources})`);
    } else {
      conditions.push(`source = '${filters.source}'`);
    }
  }

  if (filters.minRating !== undefined) {
    conditions.push(`"userRating" >= ${filters.minRating}`);
  }

  if (filters.maxRating !== undefined) {
    conditions.push(`"userRating" <= ${filters.maxRating}`);
  }

  if (filters.dateStart) {
    conditions.push(`"dateRead" >= '${filters.dateStart}'`);
  }

  if (filters.dateEnd) {
    conditions.push(`"dateRead" <= '${filters.dateEnd}'`);
  }

  if (filters.userId) {
    conditions.push(`"userId" = '${filters.userId}'`);
  }

  if (filters.author) {
    conditions.push(`"bookAuthor" ILIKE '%${filters.author}%'`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM "DocumentChunk" ${whereClause}`,
    );

    return Number(result[0].count);
  } catch (error) {
    console.error('[pgvector] Error counting chunks:', error);
    return 0;
  }
}

/**
 * Insert a chunk with embedding
 */
export async function insertChunk(data: {
  id?: string;
  content: string;
  embedding: number[];
  source: string;
  fileName: string;
  filePath: string;
  fileType?: string;
  chunkIndex?: number;
  totalChunks?: number;
  // Optional metadata
  fileId?: string;
  bookId?: string;
  userId?: string;
  userName?: string;
  bookTitle?: string;
  bookAuthor?: string;
  userRating?: number;
  dateRead?: string;
  readDates?: string;
  readCount?: number;
  shelves?: string;
  paperlessId?: number;
  paperlessTitle?: string;
  paperlessTags?: string;
  paperlessCorrespondent?: string;
  documentDate?: string;
}): Promise<string> {
  const embeddingStr = embeddingToSql(data.embedding);
  const id = data.id || crypto.randomUUID();

  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "DocumentChunk" (
        id, content, embedding, source, "fileName", "filePath", "fileType",
        "chunkIndex", "totalChunks",
        "fileId", "bookId",
        "userId", "userName", "bookTitle", "bookAuthor",
        "userRating", "dateRead", "readDates", "readCount", "shelves",
        "paperlessId", "paperlessTitle", "paperlessTags", "paperlessCorrespondent", "documentDate",
        "embeddingVersion", "lastEmbedded", "createdAt", "updatedAt"
      ) VALUES (
        '${id}', '${data.content.replace(/'/g, "''")}', '${embeddingStr}'::vector,
        '${data.source}', '${data.fileName}', '${data.filePath}', ${data.fileType ? `'${data.fileType}'` : 'NULL'},
        ${data.chunkIndex || 0}, ${data.totalChunks || 1},
        ${data.fileId ? `'${data.fileId}'` : 'NULL'}, ${data.bookId ? `'${data.bookId}'` : 'NULL'},
        ${data.userId ? `'${data.userId}'` : 'NULL'}, ${data.userName ? `'${data.userName}'` : 'NULL'},
        ${data.bookTitle ? `'${data.bookTitle}'` : 'NULL'}, ${data.bookAuthor ? `'${data.bookAuthor}'` : 'NULL'},
        ${data.userRating || 'NULL'}, ${data.dateRead ? `'${data.dateRead}'` : 'NULL'},
        ${data.readDates ? `'${data.readDates}'` : 'NULL'}, ${data.readCount || 'NULL'},
        ${data.shelves ? `'${data.shelves}'` : 'NULL'},
        ${data.paperlessId || 'NULL'}, ${data.paperlessTitle ? `'${data.paperlessTitle}'` : 'NULL'},
        ${data.paperlessTags ? `'${data.paperlessTags}'` : 'NULL'},
        ${data.paperlessCorrespondent ? `'${data.paperlessCorrespondent}'` : 'NULL'},
        ${data.documentDate ? `'${data.documentDate}'` : 'NULL'},
        1, NOW(), NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        "lastEmbedded" = NOW(),
        "updatedAt" = NOW()
    `);

    return id;
  } catch (error) {
    console.error('[pgvector] Error inserting chunk:', error);
    throw error;
  }
}
