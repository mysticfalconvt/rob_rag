import { generateEmbedding } from "./ai";

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SourceWithRelevance {
  fileName: string;
  filePath: string;
  chunk: string;
  score: number;
  source: string;
  relevanceScore: number; // How relevant this chunk was to the actual response
  isReferenced: boolean; // Whether this chunk was likely used in the response
}

/**
 * Analyze which chunks were actually referenced in the LLM response
 * Uses a more sophisticated approach combining embedding similarity and statistical analysis
 *
 * @param response The LLM's response text
 * @param sources All retrieved source chunks
 * @returns Sources with relevance scores and isReferenced flags
 */
export async function analyzeReferencedSources(
  response: string,
  sources: Array<{
    fileName: string;
    filePath: string;
    chunk: string;
    score: number;
    source: string;
  }>,
): Promise<SourceWithRelevance[]> {
  if (!response || sources.length === 0) {
    return sources.map((s) => ({
      ...s,
      relevanceScore: 0,
      isReferenced: false,
    }));
  }

  try {
    // Generate embedding for the response
    const responseEmbedding = await generateEmbedding(response);

    // Calculate similarity for each source chunk
    const sourcesWithRelevance = await Promise.all(
      sources.map(async (source) => {
        // Generate embedding for this chunk
        const chunkEmbedding = await generateEmbedding(source.chunk);

        // Calculate similarity
        const relevanceScore = cosineSimilarity(
          responseEmbedding,
          chunkEmbedding,
        );

        return {
          ...source,
          relevanceScore,
          isReferenced: false, // Will be set below
        };
      }),
    );

    // Sort by relevance score (highest first)
    sourcesWithRelevance.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Calculate statistics for adaptive thresholding
    const scores = sourcesWithRelevance.map((s) => s.relevanceScore);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Calculate standard deviation
    const variance =
      scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) /
      scores.length;
    const stdDev = Math.sqrt(variance);

    // Adaptive threshold: Use mean + 0.5 * stdDev, but at least 0.4
    // This ensures we only mark sources that are significantly above average
    const adaptiveThreshold = Math.max(0.4, avgScore + 0.5 * stdDev);

    // Alternative: Use top 40% of sources or those significantly above average
    const topNPercent = Math.max(1, Math.ceil(sources.length * 0.4));

    // Mark sources as referenced using the more restrictive of the two methods
    sourcesWithRelevance.forEach((source, index) => {
      const meetsThreshold = source.relevanceScore >= adaptiveThreshold;
      const inTopN = index < topNPercent;

      // Must be both in top N AND meet the adaptive threshold, OR be significantly higher than others
      source.isReferenced = meetsThreshold && inTopN;
    });

    // Ensure at least one source is marked if any exist
    if (
      sourcesWithRelevance.length > 0 &&
      !sourcesWithRelevance.some((s) => s.isReferenced)
    ) {
      sourcesWithRelevance[0].isReferenced = true;
    }


    return sourcesWithRelevance;
  } catch (error) {
    console.error("[SourceAnalysis] Error analyzing sources:", error);
    // On error, return all sources as unreferenced
    return sources.map((s) => ({
      ...s,
      relevanceScore: 0,
      isReferenced: false,
    }));
  }
}
