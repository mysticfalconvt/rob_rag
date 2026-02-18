/**
 * Web Search Provider Module
 *
 * Dual-backend web search: SearXNG (fast meta-search) and Perplexica (deep AI research).
 * SearXNG returns raw results for LLM synthesis; Perplexica returns pre-synthesized answers.
 */

// --- Types ---

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
  score?: number;
  publishedDate?: string;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  synthesizedAnswer?: string;
}

export interface WebSearchOptions {
  maxResults?: number;
  engines?: string[];
  categories?: string[];
  language?: string;
  timeRange?: "day" | "week" | "month" | "year" | "all";
}

// --- Configuration ---

function getSearXNGUrl(): string | undefined {
  return process.env.SEARXNG_URL;
}

function getPerplexicaUrl(): string | undefined {
  return process.env.PERPLEXICA_URL;
}

export function isSearXNGConfigured(): boolean {
  return !!getSearXNGUrl();
}

export function isPerplexicaConfigured(): boolean {
  return !!getPerplexicaUrl();
}

export function isWebSearchConfigured(): boolean {
  return isSearXNGConfigured() || isPerplexicaConfigured();
}

// --- Perplexica Provider Discovery ---

interface PerplexicaModelRef {
  providerId: string;
  key: string;
}

let cachedProviders: { chat?: PerplexicaModelRef; embedding?: PerplexicaModelRef } | null = null;

async function getPerplexicaProviders(): Promise<{ chat?: PerplexicaModelRef; embedding?: PerplexicaModelRef }> {
  // Use env overrides if set
  const chatProviderId = process.env.PERPLEXICA_CHAT_PROVIDER_ID;
  const chatModelKey = process.env.PERPLEXICA_CHAT_MODEL_KEY;
  const embeddingProviderId = process.env.PERPLEXICA_EMBEDDING_PROVIDER_ID;
  const embeddingModelKey = process.env.PERPLEXICA_EMBEDDING_MODEL_KEY;

  if (chatProviderId && chatModelKey && embeddingProviderId && embeddingModelKey) {
    return {
      chat: { providerId: chatProviderId, key: chatModelKey },
      embedding: { providerId: embeddingProviderId, key: embeddingModelKey },
    };
  }

  if (cachedProviders) return cachedProviders;

  const baseUrl = getPerplexicaUrl();
  if (!baseUrl) return {};

  try {
    const response = await fetch(`${baseUrl}/api/providers`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`[WebSearch] Perplexica /api/providers returned ${response.status}`);
      return {};
    }

    const data = await response.json();
    const providers = data.providers || [];

    // Auto-discover first available chat and embedding models
    const result: { chat?: PerplexicaModelRef; embedding?: PerplexicaModelRef } = {};

    for (const provider of providers) {
      if (!result.chat && provider.chatModels?.length > 0) {
        result.chat = { providerId: provider.id, key: provider.chatModels[0].key };
      }
      if (!result.embedding && provider.embeddingModels?.length > 0) {
        result.embedding = { providerId: provider.id, key: provider.embeddingModels[0].key };
      }
      if (result.chat && result.embedding) break;
    }

    cachedProviders = result;
    console.log("[WebSearch] Perplexica providers discovered:", JSON.stringify(result));
    return result;
  } catch (error) {
    console.warn("[WebSearch] Failed to discover Perplexica providers:", error instanceof Error ? error.message : error);
    return {};
  }
}

// --- SearXNG ---

export async function searchSearXNG(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
  const baseUrl = getSearXNGUrl();
  if (!baseUrl) {
    console.warn("[WebSearch] SearXNG not configured");
    return { results: [] };
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: "json",
    });

    if (options.engines?.length) {
      params.set("engines", options.engines.join(","));
    }
    if (options.categories?.length) {
      params.set("categories", options.categories.join(","));
    }
    if (options.language) {
      params.set("language", options.language);
    }
    if (options.timeRange && options.timeRange !== "all") {
      params.set("time_range", options.timeRange);
    }

    const response = await fetch(`${baseUrl}/search?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[WebSearch] SearXNG returned ${response.status}`);
      return { results: [] };
    }

    const data = await response.json();
    const maxResults = options.maxResults || 10;

    const results: WebSearchResult[] = (data.results || [])
      .slice(0, maxResults)
      .map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.content || "",
        engine: Array.isArray(r.engines) ? r.engines[0] : r.engine,
        score: r.score,
        publishedDate: r.publishedDate || r.published_date,
      }));

    console.log(`[WebSearch] SearXNG returned ${results.length} results for "${query.substring(0, 50)}"`);
    return { results };
  } catch (error) {
    console.warn("[WebSearch] SearXNG search failed:", error instanceof Error ? error.message : error);
    return { results: [] };
  }
}

// --- Perplexica ---

export async function searchPerplexica(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
  const baseUrl = getPerplexicaUrl();
  if (!baseUrl) {
    console.warn("[WebSearch] Perplexica not configured");
    return { results: [] };
  }

  try {
    const providers = await getPerplexicaProviders();

    if (!providers.chat || !providers.embedding) {
      console.warn("[WebSearch] Perplexica providers not available");
      return { results: [] };
    }

    const requestBody: Record<string, unknown> = {
      chatModel: {
        providerId: providers.chat.providerId,
        key: providers.chat.key,
      },
      embeddingModel: {
        providerId: providers.embedding.providerId,
        key: providers.embedding.key,
      },
      query,
      sources: ["web"],
      optimizationMode: "balanced",
      stream: false,
    };

    console.log(`[WebSearch] Perplexica request: chat=${providers.chat.key}, embedding=${providers.embedding.key}, query="${query.substring(0, 50)}"`);

    const response = await fetch(`${baseUrl}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(180000), // 3 minutes - Perplexica with large models can be slow
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.warn(`[WebSearch] Perplexica returned ${response.status}: ${errorBody.substring(0, 200)}`);
      return { results: [] };
    }

    const data = await response.json();

    const results: WebSearchResult[] = (data.sources || [])
      .slice(0, options.maxResults || 10)
      .map((s: any) => ({
        title: s.metadata?.title || "",
        url: s.metadata?.url || "",
        snippet: s.content || "",
      }));

    const synthesizedAnswer = data.message || undefined;

    console.log(`[WebSearch] Perplexica returned ${results.length} sources with ${synthesizedAnswer ? "synthesized answer" : "no synthesized answer"}`);
    return { results, synthesizedAnswer };
  } catch (error) {
    console.warn("[WebSearch] Perplexica search failed:", error instanceof Error ? error.message : error);
    return { results: [] };
  }
}

// --- Shared Interfaces ---

/**
 * Quick web search via SearXNG. Falls back to Perplexica if SearXNG is not configured.
 */
export async function searchWeb(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
  if (isSearXNGConfigured()) {
    return searchSearXNG(query, options);
  }
  if (isPerplexicaConfigured()) {
    return searchPerplexica(query, options);
  }
  console.warn("[WebSearch] No web search backend configured");
  return { results: [] };
}

/**
 * Deep research via Perplexica. Returns synthesized answer + sources.
 */
export async function searchDeep(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
  if (isPerplexicaConfigured()) {
    return searchPerplexica(query, options);
  }
  // Fallback to SearXNG if Perplexica is not available
  if (isSearXNGConfigured()) {
    console.warn("[WebSearch] Perplexica not configured, falling back to SearXNG for deep research");
    return searchSearXNG(query, options);
  }
  console.warn("[WebSearch] No web search backend configured");
  return { results: [] };
}

/**
 * Format web search results as context string for the LLM.
 * Caps output to ~2000 tokens (~8000 chars).
 */
export function formatWebResultsAsContext(response: WebSearchResponse): string {
  const MAX_CHARS = 8000;
  const parts: string[] = [];

  if (response.synthesizedAnswer) {
    parts.push("## Web Research Summary\n");
    parts.push(response.synthesizedAnswer);
    parts.push("\n\n## Sources\n");

    for (const result of response.results) {
      const line = `- [${result.title}](${result.url})`;
      parts.push(line);
    }
  } else {
    parts.push("## Web Search Results\n");

    for (const result of response.results) {
      const entry = `### ${result.title}\n**URL:** ${result.url}\n${result.snippet}\n`;
      parts.push(entry);
    }
  }

  let output = parts.join("\n");
  if (output.length > MAX_CHARS) {
    output = output.substring(0, MAX_CHARS) + "\n\n[Results truncated]";
  }

  return output;
}
