import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  searchWeb,
  searchDeep,
  formatWebResultsAsContext,
  isSearXNGConfigured,
  isPerplexicaConfigured,
} from "../webSearch";

/**
 * Web search tool (SearXNG) - for quick lookups, current events, factual queries
 */
export const webSearchTool = new DynamicStructuredTool({
  name: "web_search",
  description: `Search the web for current information, news, and facts. Use this tool when:
- The user asks about current events, recent news, or trending topics
- The user needs up-to-date information (weather, stock prices, sports scores)
- The question requires knowledge beyond what's in the local documents
- The user explicitly asks to search the web or look something up online
- The query references recent dates (2025, 2026) or asks "what's happening"

This returns web search results that you should synthesize into a helpful answer.`,
  schema: z.object({
    query: z.string().describe("The search query to look up on the web"),
    timeRange: z
      .enum(["day", "week", "month", "year", "all"])
      .optional()
      .describe("Time range filter for results. Use 'day' for today's news, 'week' for recent events, etc."),
  }),
  func: async ({ query, timeRange }) => {
    try {
      const response = await searchWeb(query, { timeRange: timeRange as any });

      if (response.results.length === 0) {
        return "No web search results found for this query. Try rephrasing or broadening your search.";
      }

      return formatWebResultsAsContext(response);
    } catch (error) {
      console.error("[WebSearchTool] Error:", error);
      return "Web search is temporarily unavailable. Please try again later.";
    }
  },
});

/**
 * Deep research tool (Perplexica) - for complex research questions
 */
export const deepResearchTool = new DynamicStructuredTool({
  name: "deep_research",
  description: `Perform deep web research on a topic using AI-powered analysis. Use this tool when:
- The user asks for a comprehensive or in-depth analysis
- The question requires synthesizing information from multiple sources
- Academic or research-oriented queries
- Complex topics that need thorough investigation
- The user explicitly asks for "research" or "detailed analysis"

This returns a synthesized research summary with source citations.`,
  schema: z.object({
    query: z.string().describe("The research question or topic to investigate in depth"),
  }),
  func: async ({ query }) => {
    try {
      const response = await searchDeep(query);

      if (response.results.length === 0 && !response.synthesizedAnswer) {
        return "No research results found for this query. Try rephrasing or broadening your search.";
      }

      return formatWebResultsAsContext(response);
    } catch (error) {
      console.error("[DeepResearchTool] Error:", error);
      return "Deep research is temporarily unavailable. Please try again later.";
    }
  },
});

/**
 * Check if the web search tool should be available
 */
export function isWebSearchToolAvailable(): boolean {
  return isSearXNGConfigured() || isPerplexicaConfigured();
}

/**
 * Check if the deep research tool should be available
 */
export function isDeepResearchToolAvailable(): boolean {
  return isPerplexicaConfigured();
}
