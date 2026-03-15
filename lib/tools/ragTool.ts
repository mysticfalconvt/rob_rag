import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { search, SearchResult } from "../retrieval";
import { smartSearch } from "../smartRetrieval";
import { readFileContent } from "../files";
import {
  buildSearchQueryWithUserContext,
  rephraseQuestionIfNeeded,
} from "../contextBuilder";
import { routeQuery } from "../queryRouter";
import {
  shouldRetrieveMore,
  retrieveAdditionalContext,
} from "../iterativeRetrieval";
import type { LLMCallMetrics } from "../llmTracking";
import prisma from "../prisma";

export interface RagToolConfig {
  sourceFilter: string | string[] | undefined;
  sourceCount: number;
  documentPath: string | null;
  userName: string | null;
  userBio: string | null;
  isFirstMessage: boolean;
  conversationHistory: any[];
  onEmbeddingMetrics?: (metrics: LLMCallMetrics) => void | Promise<void>;
  /** Callback to report structured search results back to the caller for source attribution */
  onSearchResults?: (results: SearchResult[]) => void;
}

/**
 * Create a per-request RAG tool that encapsulates the full retrieval flow:
 * query enhancement, smart search, context optimization, and iterative retrieval.
 */
export function createRagTool(config: RagToolConfig): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "search_knowledge_base",
    description:
      `Search the user's personal knowledge base including their synced files, uploaded documents, ` +
      `books (Goodreads), Paperless documents, and Google Calendar events. ` +
      `Use this tool when the user asks about their personal data, documents, books they've read, ` +
      `calendar events, notes, or any stored information. ` +
      `Do NOT use this for general knowledge questions you can answer directly (jokes, definitions, math, common facts). ` +
      `When in doubt about whether the user is asking about personal data, use this tool.`,
    schema: z.object({
      query: z.string().describe(
        "The search query to find relevant documents. Rephrase the user's question as a clear search query."
      ),
      source_filter: z.enum(["all", "goodreads", "paperless", "uploaded", "synced", "google-calendar"])
        .optional()
        .describe(
          "Optional: filter to search only a specific data source. Use 'goodreads' for books, " +
          "'paperless' for Paperless documents, 'google-calendar' for calendar events, etc. " +
          "Default is to search all sources."
        ),
    }),
    func: async ({ query, source_filter }) => {
      try {
        console.log(`[RAGTool] Searching knowledge base: "${query.substring(0, 80)}"`);

        // Determine effective source filter (UI filter takes precedence)
        const effectiveFilter = resolveSourceFilter(config.sourceFilter, source_filter);

        // Single-document mode
        if (config.documentPath) {
          return await searchSingleDocument(config.documentPath, query, config.onEmbeddingMetrics);
        }

        // Enhance search query
        let searchQuery = query;
        if (config.isFirstMessage) {
          searchQuery = buildSearchQueryWithUserContext(query, config.userName, config.userBio);
        } else {
          const { rephrased, wasRephrased } = await rephraseQuestionIfNeeded(
            query,
            config.conversationHistory,
          );
          if (wasRephrased) {
            searchQuery = rephrased;
          }
        }

        // Route query for fast/slow path
        const queryRoute = routeQuery(query, config.isFirstMessage, config.conversationHistory);

        // Execute search
        const clampedSourceCount = Math.max(1, Math.min(35, config.sourceCount));
        let searchResults: SearchResult[];

        if (!effectiveFilter || effectiveFilter === "all") {
          if (queryRoute.path === "fast") {
            console.log("[RAGTool] Fast path: direct search");
            searchResults = await search(searchQuery, 10, "all", config.onEmbeddingMetrics);
          } else {
            console.log("[RAGTool] Slow path: smart search");
            const smartResult = await smartSearch(searchQuery, undefined, clampedSourceCount, config.onEmbeddingMetrics);
            searchResults = smartResult.results;
          }
        } else {
          searchResults = await search(searchQuery, clampedSourceCount, effectiveFilter as any, config.onEmbeddingMetrics);
        }

        if (searchResults.length === 0) {
          return "No relevant documents found in the knowledge base for this query.";
        }

        // Report structured results back for source attribution
        if (config.onSearchResults) {
          config.onSearchResults(searchResults);
        }

        // Context optimization: group by file, load full content for small files
        const contextParts = await buildContextFromResults(searchResults);

        // Iterative retrieval: check if we need more context (slow path only)
        if (!queryRoute.skipIterativeRetrieval && searchResults.length < 35) {
          const additionalContext = await tryIterativeRetrieval(
            query,
            searchResults,
            effectiveFilter,
            contextParts,
          );
          if (additionalContext.length > 0) {
            contextParts.push(...additionalContext);
          }
        }

        const context = contextParts.join("\n\n");
        console.log(`[RAGTool] Returning ${searchResults.length} results, ${context.length} chars`);
        return context;
      } catch (error) {
        console.error("[RAGTool] Error:", error);
        return `Error searching knowledge base: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
}

/**
 * Resolve the effective source filter: UI filter takes precedence over LLM's choice.
 */
function resolveSourceFilter(
  uiFilter: string | string[] | undefined,
  llmFilter: string | undefined,
): string | string[] | undefined {
  // If UI has a specific filter set (not "all" or undefined), enforce it
  if (uiFilter && uiFilter !== "all" && uiFilter !== "none") {
    return uiFilter;
  }
  // Otherwise use LLM's suggestion
  return llmFilter || "all";
}

/**
 * Search within a single document (for document-chat mode).
 */
async function searchSingleDocument(
  documentPath: string,
  query: string,
  onEmbeddingMetrics?: (metrics: LLMCallMetrics) => void | Promise<void>,
): Promise<string> {
  const fileRecord = await prisma.indexedFile.findUnique({
    where: { filePath: documentPath },
    select: { chunkCount: true, source: true, paperlessTitle: true },
  });

  if (!fileRecord) {
    return `Document not found: ${documentPath}`;
  }

  const docDisplayName =
    fileRecord.paperlessTitle ??
    documentPath.split("/").filter(Boolean).pop() ??
    "document";
  const isVirtualSource =
    fileRecord.source === "goodreads" ||
    fileRecord.source === "paperless" ||
    fileRecord.source === "google-calendar";
  const fullContentMaxChars = 12000;
  const fullContentMaxChunks = 20;

  // Try to load full content for small, non-virtual files
  if (!isVirtualSource && fileRecord.chunkCount <= fullContentMaxChunks) {
    try {
      const { content: fullContent } = await readFileContent(documentPath);
      if (fullContent.length <= fullContentMaxChars) {
        return `Document: ${docDisplayName}\n(Full content - single document chat)\n${fullContent}`;
      }
    } catch (e) {
      // Fall through to chunk search
    }
  }

  // Chunk search scoped to document
  const results = await search(query, 25, undefined, onEmbeddingMetrics, documentPath);
  if (results.length === 0) {
    return `No relevant sections found in document: ${docDisplayName}`;
  }

  const parts: string[] = [];
  const processedFiles = new Set<string>();
  for (const result of results) {
    const filePath = result.metadata.filePath;
    if (!filePath || processedFiles.has(filePath)) continue;
    processedFiles.add(filePath);
    parts.push(`Document: ${result.metadata.fileName}\nContent: ${result.content}`);
  }
  return parts.join("\n\n");
}

/**
 * Build context from search results with full-file loading optimization.
 *
 * Loads full document content when:
 * 1. File is small (<= 5 chunks) or we have >30% of its chunks (existing logic)
 * 2. A chunk has a significantly higher score than the average — strong signal
 *    that the whole document is highly relevant (score-based loading)
 *
 * Full-file loading is capped at 20k chars per file and 3 files max to avoid
 * overwhelming the context window.
 */
async function buildContextFromResults(searchResults: SearchResult[]): Promise<string[]> {
  const contextParts: string[] = [];
  const FULL_CONTENT_MAX_CHARS = 20000; // ~5k tokens per file
  const MAX_FULL_FILES = 3;
  let fullFilesLoaded = 0;

  // Group by file
  const groupedResults: Record<string, SearchResult[]> = {};
  searchResults.forEach((r) => {
    const path = r.metadata.filePath;
    if (path) {
      if (!groupedResults[path]) groupedResults[path] = [];
      groupedResults[path].push(r);
    }
  });

  // Compute average score across all results for score-based full-doc loading
  const avgScore = searchResults.length > 0
    ? searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length
    : 0;

  const processedFiles = new Set<string>();

  for (const result of searchResults) {
    const filePath = result.metadata.filePath;
    if (!filePath || processedFiles.has(filePath)) continue;

    const fileResults = groupedResults[filePath];
    const totalChunks = result.metadata.totalChunks || 100;
    const source = result.metadata.source;

    const isVirtualSource =
      source === "goodreads" || source === "paperless" || source === "google-calendar";

    // Existing heuristics
    const isSmallFile = totalChunks <= 5;
    const hasSignificantPortion = fileResults.length / totalChunks > 0.3;

    // Score-based heuristic: if the best chunk from this file scores >25% above
    // the overall average, the document is a strong match — load full content
    const bestFileScore = Math.max(...fileResults.map((r) => r.score));
    const hasHighScoreChunk = avgScore > 0 && bestFileScore > avgScore * 1.25;

    const shouldLoadFull =
      !isVirtualSource &&
      fullFilesLoaded < MAX_FULL_FILES &&
      (isSmallFile || hasSignificantPortion || hasHighScoreChunk);

    if (shouldLoadFull) {
      try {
        const { content: fullContent } = await readFileContent(filePath);
        if (fullContent.length <= FULL_CONTENT_MAX_CHARS) {
          const reason = hasHighScoreChunk && !isSmallFile && !hasSignificantPortion
            ? "high relevance score"
            : isSmallFile ? "small file" : "significant chunk coverage";
          console.log(`[RAGTool] Loading full document: ${result.metadata.fileName} (${reason}, score: ${bestFileScore.toFixed(3)} vs avg: ${avgScore.toFixed(3)})`);
          contextParts.push(
            `Document: ${result.metadata.fileName}\n(Full Content)\n${fullContent}`,
          );
          processedFiles.add(filePath);
          fullFilesLoaded++;
          continue;
        }
        // File too large for full load — fall through to chunk mode
      } catch (e) {
        // Fall through to chunk mode
      }
    }

    // Chunk mode: add individual chunks for this file
    for (const chunk of fileResults) {
      if (!processedFiles.has(filePath)) {
        contextParts.push(
          `Document: ${chunk.metadata.fileName}\nContent: ${chunk.content}`,
        );
      }
    }
    processedFiles.add(filePath);
  }

  return contextParts;
}

/**
 * Try iterative retrieval to get more context if needed.
 */
async function tryIterativeRetrieval(
  query: string,
  searchResults: SearchResult[],
  sourceFilter: string | string[] | undefined,
  _existingContextParts: string[],
): Promise<string[]> {
  const MAX_TOTAL_CHUNKS = 35;
  const additionalParts: string[] = [];

  try {
    const analysis = await shouldRetrieveMore(
      query,
      "", // No partial response yet — check based on result count
      searchResults.length,
      MAX_TOTAL_CHUNKS,
    );

    if (analysis.shouldRetrieve && analysis.suggestedCount) {
      const iterativeFilter = sourceFilter === "all" || !sourceFilter ? "all" as const : sourceFilter as string[];
      const moreResults = await retrieveAdditionalContext(
        query,
        searchResults,
        iterativeFilter,
        analysis.suggestedCount,
      );

      for (const result of moreResults) {
        additionalParts.push(
          `Document: ${result.metadata.fileName}\nContent: ${result.content}`,
        );
      }

      if (additionalParts.length > 0) {
        console.log(`[RAGTool] Iterative retrieval added ${additionalParts.length} more chunks`);
      }
    }
  } catch (error) {
    console.error("[RAGTool] Iterative retrieval error:", error);
  }

  return additionalParts;
}
