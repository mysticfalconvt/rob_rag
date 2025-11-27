import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { smartSearch } from "./smartRetrieval";
import { SearchResult } from "./retrieval";

/**
 * Create a LangChain tool that allows the LLM to request more context
 * This enables iterative retrieval where the LLM can ask for more chunks if needed
 */
export function createRetrievalTool(
  currentQuery: string,
  currentSources: string[] | "all",
  alreadyRetrieved: SearchResult[],
  maxChunks: number = 20,
) {
  return new DynamicStructuredTool({
    name: "search_for_more_context",
    description:
      "Search for additional document chunks if you need more information to answer the user's question thoroughly. " +
      "Use this when: 1) The current context is insufficient, 2) You need more specific details, " +
      "3) The query is complex and requires broader context. " +
      "Do NOT use this if you already have enough information to answer the question.",
    schema: z.object({
      reason: z
        .string()
        .describe(
          "Brief explanation of why you need more context (e.g., 'Need more details about X')",
        ),
      focusArea: z
        .string()
        .optional()
        .describe(
          "Optional: specific aspect or keywords to focus the search on",
        ),
      additionalChunks: z
        .number()
        .min(1)
        .max(15)
        .default(5)
        .describe("Number of additional chunks to retrieve (1-15, default: 5)"),
    }),
    func: async ({ reason, focusArea, additionalChunks }) => {
      console.log("[RetrievalTool] LLM requesting more context:", {
        reason,
        focusArea,
        additionalChunks,
      });

      // Use focusArea if provided, otherwise use original query
      const searchQuery = focusArea || currentQuery;

      // Calculate how many we can still retrieve
      const alreadyCount = alreadyRetrieved.length;
      const remainingAllowed = maxChunks - alreadyCount;

      if (remainingAllowed <= 0) {
        return JSON.stringify({
          success: false,
          message: `Maximum chunk limit (${maxChunks}) already reached. Cannot retrieve more.`,
          chunksRetrieved: 0,
        });
      }

      const chunksToRetrieve = Math.min(
        additionalChunks,
        remainingAllowed,
      );

      console.log(
        `[RetrievalTool] Retrieving ${chunksToRetrieve} more chunks (${alreadyCount} already retrieved, ${maxChunks} max)`,
      );

      // Search for more context
      const result = await smartSearch(
        searchQuery,
        currentSources === "all" ? undefined : currentSources,
        chunksToRetrieve,
      );

      // Filter out chunks we already have (by content to avoid duplicates)
      const existingContent = new Set(alreadyRetrieved.map((r) => r.content));
      const newResults = result.results.filter(
        (r) => !existingContent.has(r.content),
      );

      console.log(
        `[RetrievalTool] Found ${newResults.length} new unique chunks`,
      );

      if (newResults.length === 0) {
        return JSON.stringify({
          success: false,
          message:
            "No additional unique chunks found. You may need to work with the existing context.",
          chunksRetrieved: 0,
        });
      }

      // Return the new chunks as formatted context
      const contextAddition = newResults
        .map(
          (r) =>
            `Document: ${r.metadata.fileName}\nSource: ${r.metadata.source || "synced"}\nContent: ${r.content}`,
        )
        .join("\n\n---\n\n");

      return JSON.stringify({
        success: true,
        message: `Retrieved ${newResults.length} additional chunks.`,
        chunksRetrieved: newResults.length,
        newContext: contextAddition,
        sources: newResults.map((r) => ({
          fileName: r.metadata.fileName,
          source: r.metadata.source || "synced",
          score: r.score,
        })),
      });
    },
  });
}

/**
 * Check if the model supports tool calling
 * Some models don't have good function calling support
 */
export function shouldEnableIterativeRetrieval(modelName: string): boolean {
  const modelLower = modelName.toLowerCase();

  // Models known to have good function calling
  const goodFunctionCallingModels = [
    "gpt-4",
    "gpt-3.5",
    "claude",
    "gemini",
    "mistral",
    "command", // Cohere
    "qwen", // Qwen models have decent function calling
  ];

  return goodFunctionCallingModels.some((name) => modelLower.includes(name));
}
