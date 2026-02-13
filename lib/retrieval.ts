import { generateEmbedding } from "./ai";
import type { LLMCallMetrics } from "./llmTracking";
import { searchWithPgVector } from "./pgvector";

export interface SearchResult {
  content: string;
  metadata: Record<string, any>;
  score: number;
}

/**
 * Search function using PostgreSQL with pgvector
 * @param documentPath - Optional: restrict results to this document only (single-doc chat)
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
  onEmbeddingMetrics?: (metrics: LLMCallMetrics) => void | Promise<void>,
  documentPath?: string,
): Promise<SearchResult[]> {
  try {
    const queryEmbedding = await generateEmbedding(query, onEmbeddingMetrics);
    console.log("[Retrieval] Using PostgreSQL pgvector for search");
    const results = await searchWithPgVector(queryEmbedding, limit, sourceFilter, documentPath);

    // Apply tag-based score boosting
    return await boostScoresByTags(results, query);
  } catch (error) {
    console.error("[Retrieval] Error searching:", error);
    return [];
  }
}

/**
 * Boost search scores for documents with tags matching the query
 */
async function boostScoresByTags(
  results: SearchResult[],
  query: string,
): Promise<SearchResult[]> {
  try {
    const prisma = (await import("./prisma")).default;

    // Normalize query terms for matching
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2); // Only consider terms longer than 2 chars

    // For each result, get the document's tags and apply boost if they match
    const boostedResults = await Promise.all(
      results.map(async (result) => {
        try {
          // Get file record with tags
          const fileRecord = await prisma.indexedFile.findUnique({
            where: { filePath: result.metadata.filePath },
            include: {
              documentTags: {
                include: { tag: true },
              },
            },
          });

          if (!fileRecord?.documentTags || fileRecord.documentTags.length === 0) {
            return result;
          }

          // Check if any tags match query terms
          const tags = fileRecord.documentTags.map((dt) => dt.tag.name.toLowerCase());
          const matchingTags = tags.filter((tag) =>
            queryTerms.some((term) => tag.includes(term) || term.includes(tag)),
          );

          // Apply boost: 10% boost per matching tag, up to 30% total boost
          const boostFactor = Math.min(matchingTags.length * 0.1, 0.3);
          const boostedScore = Math.min(result.score * (1 + boostFactor), 1.0);

          if (matchingTags.length > 0) {
            console.log(
              `[Retrieval] Boosted score for ${result.metadata.filePath} from ${result.score.toFixed(3)} to ${boostedScore.toFixed(3)} (${matchingTags.length} matching tags)`,
            );
          }

          return {
            ...result,
            score: boostedScore,
          };
        } catch (error) {
          console.error(`Error boosting score for ${result.metadata.filePath}:`, error);
          return result;
        }
      }),
    );

    // Re-sort by boosted scores
    return boostedResults.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("[Retrieval] Error boosting scores by tags:", error);
    return results; // Return original results on error
  }
}
