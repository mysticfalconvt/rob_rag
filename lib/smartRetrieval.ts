import { search, SearchResult } from "./retrieval";
import type { LLMCallMetrics } from "./llmTracking";

/**
 * Query classification results
 */
export interface QueryAnalysis {
  queryType: "book" | "document" | "general" | "mixed";
  complexity: "simple" | "moderate" | "complex";
  suggestedSources: string[] | "all";
  suggestedChunkCount: number;
  confidence: number; // 0-1, how confident we are in the classification
  keywords: string[];
}

/**
 * Analyze a query to determine optimal retrieval strategy
 */
export function analyzeQuery(query: string): QueryAnalysis {
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/);
  const wordCount = words.length;

  // Book-related keywords
  const bookKeywords = [
    "book",
    "books",
    "read",
    "reading",
    "author",
    "novel",
    "story",
    "chapter",
    "goodreads",
    "rated",
    "rating",
    "review",
    "fiction",
    "non-fiction",
    "memoir",
    "biography",
  ];

  // Document-related keywords
  const documentKeywords = [
    "document",
    "documents",
    "file",
    "files",
    "pdf",
    "paperless",
    "invoice",
    "receipt",
    "tax",
    "contract",
    "report",
    "form",
    "letter",
    "memo",
    "correspondence",
  ];

  // Count keyword matches
  const bookMatches = bookKeywords.filter((kw) => lowerQuery.includes(kw));
  const docMatches = documentKeywords.filter((kw) => lowerQuery.includes(kw));

  // Determine query type
  let queryType: QueryAnalysis["queryType"] = "general";
  let confidence = 0.5;
  let suggestedSources: string[] | "all" = "all";

  if (bookMatches.length > 0 && docMatches.length === 0) {
    queryType = "book";
    confidence = Math.min(0.9, 0.6 + bookMatches.length * 0.15);
    suggestedSources = ["goodreads"];
  } else if (docMatches.length > 0 && bookMatches.length === 0) {
    queryType = "document";
    confidence = Math.min(0.9, 0.6 + docMatches.length * 0.15);
    suggestedSources = ["paperless", "uploaded", "synced"];
  } else if (bookMatches.length > 0 && docMatches.length > 0) {
    queryType = "mixed";
    confidence = 0.7;
    suggestedSources = "all";
  } else {
    queryType = "general";
    confidence = 0.5;
    suggestedSources = "all";
  }

  // Determine complexity based on query characteristics
  let complexity: QueryAnalysis["complexity"] = "moderate";

  if (wordCount <= 5) {
    complexity = "simple";
  } else if (
    wordCount > 15 ||
    lowerQuery.includes("?") ||
    lowerQuery.includes("how") ||
    lowerQuery.includes("why") ||
    lowerQuery.includes("explain")
  ) {
    complexity = "complex";
  }

  // Calculate suggested chunk count based on complexity and type
  let suggestedChunkCount = 10; // Default

  switch (complexity) {
    case "simple":
      suggestedChunkCount = 5;
      break;
    case "moderate":
      suggestedChunkCount = 10;
      break;
    case "complex":
      suggestedChunkCount = 20;
      break;
  }

  // Adjust for specific query types
  if (queryType === "book" && complexity === "simple") {
    // Simple book queries might need more context (reviews, ratings)
    suggestedChunkCount = Math.max(suggestedChunkCount, 5);
  }

  console.log("[SmartRetrieval] Query analysis:", {
    queryType,
    complexity,
    suggestedSources,
    suggestedChunkCount,
    confidence: confidence.toFixed(2),
    bookMatches: bookMatches.length,
    docMatches: docMatches.length,
  });

  return {
    queryType,
    complexity,
    suggestedSources,
    suggestedChunkCount,
    confidence,
    keywords: [...bookMatches, ...docMatches],
  };
}

/**
 * Two-stage retrieval: probe all sources, then focus on best performing
 */
export async function smartSearch(
  query: string,
  userSourceFilter?:
    | "all"
    | "uploaded"
    | "synced"
    | "paperless"
    | "goodreads"
    | "none"
    | string[],
  maxChunks: number = 35,
  onEmbeddingMetrics?: (metrics: LLMCallMetrics) => void | Promise<void>
): Promise<{
  results: SearchResult[];
  usedSources: string[] | "all";
  chunkCount: number;
}> {
  // If user has manually selected sources, respect that
  if (
    userSourceFilter &&
    userSourceFilter !== "all" &&
    userSourceFilter !== "none"
  ) {
    const analysis = analyzeQuery(query);
    const chunkCount = Math.min(analysis.suggestedChunkCount, maxChunks);

    const results = await search(query, chunkCount, userSourceFilter, onEmbeddingMetrics);

    return {
      results,
      usedSources: Array.isArray(userSourceFilter) ? userSourceFilter : "all",
      chunkCount,
    };
  }

  // Analyze query to get smart recommendations
  const analysis = analyzeQuery(query);

  // If confidence is high and we have specific source recommendations, use them directly
  if (
    analysis.confidence > 0.7 &&
    analysis.suggestedSources !== "all" &&
    analysis.suggestedSources.length > 0
  ) {
    const chunkCount = Math.min(analysis.suggestedChunkCount, maxChunks);

    console.log(
      `[SmartRetrieval] High confidence (${analysis.confidence.toFixed(2)}), using suggested sources:`,
      analysis.suggestedSources,
    );

    const results = await search(query, chunkCount, analysis.suggestedSources, onEmbeddingMetrics);

    return {
      results,
      usedSources: analysis.suggestedSources,
      chunkCount,
    };
  }

  // Low confidence or general query: do two-stage search
  console.log(
    "[SmartRetrieval] Low confidence or general query, doing two-stage search",
  );

  // Stage 1: Probe with small number from all sources
  const probeResults = await search(query, 10, "all", onEmbeddingMetrics); // Get 10 samples from all sources

  if (probeResults.length === 0) {
    return {
      results: [],
      usedSources: "all",
      chunkCount: 0,
    };
  }

  // Analyze probe results to determine best source type
  const sourceScores: Record<string, { totalScore: number; count: number }> =
    {};

  probeResults.forEach((result) => {
    const source = result.metadata.source || "synced";
    if (!sourceScores[source]) {
      sourceScores[source] = { totalScore: 0, count: 0 };
    }
    sourceScores[source].totalScore += result.score;
    sourceScores[source].count += 1;
  });

  // Calculate average score per source
  const sourceAverages = Object.entries(sourceScores).map(([source, data]) => ({
    source,
    avgScore: data.totalScore / data.count,
    count: data.count,
  }));

  sourceAverages.sort((a, b) => b.avgScore - a.avgScore);

  console.log(
    "[SmartRetrieval] Probe results by source:",
    sourceAverages.map((s) => ({
      source: s.source,
      avgScore: s.avgScore.toFixed(3),
      count: s.count,
    })),
  );

  // If top source is significantly better (>15% better avg score), focus on it
  const topSource = sourceAverages[0];
  const secondSource = sourceAverages[1];

  let focusedSources: string[] | "all" = "all";

  if (
    secondSource &&
    topSource.avgScore > secondSource.avgScore * 1.15 &&
    topSource.count >= 2
  ) {
    // Top source is clearly better
    focusedSources = [topSource.source];
    console.log(
      `[SmartRetrieval] Top source '${topSource.source}' significantly better, focusing search`,
    );
  } else if (
    sourceAverages.length > 2 &&
    topSource.avgScore > sourceAverages[2].avgScore * 1.2
  ) {
    // Top 2 sources are better than the rest
    focusedSources = [topSource.source, secondSource.source];
    console.log(
      `[SmartRetrieval] Top 2 sources better, focusing on: ${focusedSources.join(", ")}`,
    );
  } else {
    console.log("[SmartRetrieval] No clear winner, searching all sources");
  }

  // Stage 2: Get more results from focused sources
  const chunkCount = Math.min(analysis.suggestedChunkCount, maxChunks);
  const finalResults = await search(query, chunkCount, focusedSources, onEmbeddingMetrics);

  return {
    results: finalResults,
    usedSources: focusedSources,
    chunkCount,
  };
}
