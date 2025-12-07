import { generateEmbedding } from "./ai";
import { searchWithPgVector } from "./pgvector";

export interface SearchResult {
  content: string;
  metadata: Record<string, any>;
  score: number;
}

/**
 * Search function using PostgreSQL with pgvector
 */
export async function search(
  query: string,
  limit: number = 5,
  sourceFilter?:
    | "all"
    | "uploaded"
    | "synced"
    | "paperless"
    | "goodreads"
    | "none"
    | string[], // Support array of sources
): Promise<SearchResult[]> {
  try {
    const queryEmbedding = await generateEmbedding(query);
    console.log("[Retrieval] Using PostgreSQL pgvector for search");
    return await searchWithPgVector(queryEmbedding, limit, sourceFilter);
  } catch (error) {
    console.error("[Retrieval] Error searching:", error);
    return [];
  }
}
