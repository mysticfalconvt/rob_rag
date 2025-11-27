/**
 * Query Router - Determines fast vs slow path for queries
 *
 * Fast path: Simple, direct queries that don't need heavy preprocessing
 * Slow path: Complex queries that benefit from rephrasing, iterative retrieval, etc.
 */

export interface QueryRoute {
  path: "fast" | "slow";
  reason: string;
  skipRephrasing: boolean;
  skipIterativeRetrieval: boolean;
  skipSourceAnalysis: boolean;
  useTwoStageSearch: boolean;
}

/**
 * Analyze query and determine routing
 */
export function routeQuery(
  query: string,
  isFirstMessage: boolean,
  _conversationHistory: any[],
): QueryRoute {
  const lowerQuery = query.toLowerCase();
  const wordCount = query.split(/\s+/).length;

  // Fast path indicators
  const isShortQuery = wordCount <= 8;
  const isDefinitionalQuery = /^(what is|who is|when is|where is|define)/i.test(
    query,
  );
  const isSelfContained =
    !/(it|this|that|these|those|they|them|he|she|his|her|their|what about|how about|and )/i.test(
      query,
    );
  const isCountingQuery = /\b(how many|count|total|number of)\b/i.test(query);
  const isListQuery = /^(list|show me|give me|find)\s/i.test(query);

  // Slow path indicators
  const isComplexQuestion =
    /\b(why|how|explain|analyze|compare|discuss|elaborate)\b/i.test(lowerQuery);
  const isMultiPart = query.includes("?") && query.split("?").length > 2;
  const hasMultipleClauses =
    query.includes(" and ") || query.includes(" or ") || query.includes("; ");
  const isLongQuery = wordCount > 20;
  const needsContext = !isFirstMessage && !isSelfContained;

  // Scoring system
  let fastPathScore = 0;
  let slowPathScore = 0;

  // Fast path scoring
  if (isShortQuery) fastPathScore += 3;
  if (isDefinitionalQuery) fastPathScore += 2;
  if (isSelfContained) fastPathScore += 2;
  if (isCountingQuery) fastPathScore += 2;
  if (isListQuery) fastPathScore += 1;
  if (isFirstMessage) fastPathScore += 1;

  // Slow path scoring
  if (isComplexQuestion) slowPathScore += 3;
  if (isMultiPart) slowPathScore += 3;
  if (hasMultipleClauses) slowPathScore += 2;
  if (isLongQuery) slowPathScore += 2;
  if (needsContext) slowPathScore += 2;

  // Determine path
  const useFastPath = fastPathScore > slowPathScore;

  if (useFastPath) {
    return {
      path: "fast",
      reason: `Fast path: score ${fastPathScore} vs ${slowPathScore} (short=${isShortQuery}, self-contained=${isSelfContained}, definitional=${isDefinitionalQuery})`,
      skipRephrasing: true,
      skipIterativeRetrieval: true,
      skipSourceAnalysis: true,
      useTwoStageSearch: false, // Use direct search
    };
  } else {
    return {
      path: "slow",
      reason: `Slow path: score ${fastPathScore} vs ${slowPathScore} (complex=${isComplexQuestion}, multi-part=${isMultiPart}, needs-context=${needsContext})`,
      skipRephrasing: false,
      skipIterativeRetrieval: false,
      skipSourceAnalysis: false,
      useTwoStageSearch: true, // Use smart two-stage search
    };
  }
}

/**
 * Simpler search for fast path - skip the two-stage probe
 */
export function shouldUseSimpleSearch(route: QueryRoute): boolean {
  return route.path === "fast" && !route.useTwoStageSearch;
}
