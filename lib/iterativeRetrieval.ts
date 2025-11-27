import { HumanMessage } from "@langchain/core/messages";
import { getFastChatModel } from "./ai";
import { smartSearch } from "./smartRetrieval";
import { SearchResult } from "./retrieval";

/**
 * Analyze if a partial response indicates need for more context
 * Returns true if the LLM seems uncertain or mentions lacking information
 */
export async function shouldRetrieveMore(
  query: string,
  partialResponse: string,
  currentChunkCount: number,
  maxChunks: number,
): Promise<{ shouldRetrieve: boolean; reason?: string; suggestedCount?: number }> {
  // Don't retrieve more if we're already at max
  if (currentChunkCount >= maxChunks) {
    return { shouldRetrieve: false };
  }

  // Quick heuristic check first (faster than LLM call)
  const uncertaintyPhrases = [
    "i don't have",
    "i don't see",
    "i cannot find",
    "i'm not sure",
    "i don't know",
    "no information",
    "not enough information",
    "insufficient",
    "unable to find",
    "cannot determine",
    "more context needed",
    "need more details",
  ];

  const responseLower = partialResponse.toLowerCase();
  const hasUncertainty = uncertaintyPhrases.some((phrase) =>
    responseLower.includes(phrase),
  );

  if (!hasUncertainty) {
    return { shouldRetrieve: false };
  }

  console.log(
    "[IterativeRetrieval] Response shows uncertainty, checking if more retrieval would help...",
  );

  // Use fast model to analyze if more retrieval would help
  try {
    const analysisPrompt = `Analyze this Q&A interaction and determine if retrieving more document chunks would help provide a better answer.

User Question: ${query}

Current Response (partial): ${partialResponse.substring(0, 500)}

Current chunks retrieved: ${currentChunkCount}
Maximum allowed: ${maxChunks}

Respond with ONLY a JSON object (no other text) in this exact format:
{
  "shouldRetrieve": true/false,
  "reason": "brief explanation",
  "suggestedCount": number between 1-10
}

Guidelines:
- Return shouldRetrieve: true ONLY if more document chunks would likely help
- Return shouldRetrieve: false if: the answer is already satisfactory, the question is unanswerable, or no relevant documents exist
- Keep reason brief (10 words or less)
- suggestedCount should be 3-5 for targeted info, 8-10 for broad context`;

    const fastModel = await getFastChatModel();
    const response = await fastModel.invoke([new HumanMessage(analysisPrompt)]);

    const responseText =
      typeof response.content === "string" ? response.content.trim() : "{}";

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log(
        "[IterativeRetrieval] Could not parse analysis response, defaulting to no retrieval",
      );
      return { shouldRetrieve: false };
    }

    const analysis = JSON.parse(jsonMatch[0]);

    console.log("[IterativeRetrieval] Analysis result:", analysis);

    return {
      shouldRetrieve: analysis.shouldRetrieve === true,
      reason: analysis.reason,
      suggestedCount: Math.min(
        analysis.suggestedCount || 5,
        maxChunks - currentChunkCount,
      ),
    };
  } catch (error) {
    console.error("[IterativeRetrieval] Error analyzing response:", error);
    return { shouldRetrieve: false };
  }
}

/**
 * Retrieve additional context based on analysis
 */
export async function retrieveAdditionalContext(
  query: string,
  existingResults: SearchResult[],
  currentSources: string[] | "all",
  additionalCount: number,
): Promise<SearchResult[]> {
  console.log(
    `[IterativeRetrieval] Retrieving ${additionalCount} additional chunks...`,
  );

  const result = await smartSearch(
    query,
    currentSources === "all" ? undefined : currentSources,
    additionalCount,
  );

  // Filter out duplicates (by content)
  const existingContent = new Set(existingResults.map((r) => r.content));
  const newResults = result.results.filter(
    (r) => !existingContent.has(r.content),
  );

  console.log(
    `[IterativeRetrieval] Retrieved ${newResults.length} new unique chunks`,
  );

  return newResults;
}
