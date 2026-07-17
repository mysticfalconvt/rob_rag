import { generateEmbedding } from "./ai";
import type { LLMCallMetrics } from "./llmTracking";
import { listSources, searchWithPgVector } from "./pgvector";

export interface SearchResult {
  content: string;
  metadata: Record<string, any>;
  score: number;
}

/** How many chunks to pull from each source in the stage-1 probe. */
const BALANCED_PER_SOURCE = Math.max(
  1,
  Math.floor(Number(process.env.RAG_PER_SOURCE) || 4),
);
/** Drop a source's chunks below this similarity so pure noise isn't injected. */
const BALANCED_MIN_SCORE = Number(process.env.RAG_MIN_SCORE) || 0.45;
/** A source is a "winner" if its best score is within this of the global best. */
const FOCUS_DELTA = Number(process.env.RAG_FOCUS_DELTA) || 0.08;
/** Max number of winning sources to deepen in stage 2. */
const FOCUS_MAX_SOURCES = Math.max(
  1,
  Math.floor(Number(process.env.RAG_FOCUS_SOURCES) || 3),
);
/** How many chunks to pull from the winning sources in stage 2 (0 disables). */
const FOCUS_LIMIT = Math.max(
  0,
  Math.floor(Number(process.env.RAG_FOCUS_LIMIT) ?? 12),
);
/** Hard cap on total merged chunks returned (controls context size). */
const MAX_TOTAL_CHUNKS = Math.max(
  5,
  Math.floor(Number(process.env.RAG_MAX_CHUNKS) || 30),
);

function dedupeKey(r: SearchResult): string {
  const fp = r.metadata.filePath ?? "";
  const idx = r.metadata.chunkIndex;
  return idx !== undefined && idx !== null
    ? `${fp}#${idx}`
    : `${fp}#${(r.content || "").slice(0, 60)}`;
}

function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const k = dedupeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * Balanced, two-stage multi-source search.
 *
 * Stage 1 (probe): embed the query once and pull a small top-K from EACH source
 * so every source is represented — a dominant source (e.g. calendar events,
 * ~70% of all chunks) can't crowd out the source holding the answer.
 *
 * Stage 2 (focus): identify the "winning" sources (those whose best hit is within
 * FOCUS_DELTA of the global best) and pull MORE chunks from just those, for depth
 * on detailed questions. The stage-1 probe results are kept, so breadth is never
 * lost — we only ADD depth on the sources that clearly matter.
 */
export async function balancedSearch(
  query: string,
  onEmbeddingMetrics?: (metrics: LLMCallMetrics) => void | Promise<void>,
  perSource: number = BALANCED_PER_SOURCE,
  minScore: number = BALANCED_MIN_SCORE,
): Promise<SearchResult[]> {
  const queryEmbedding = await generateEmbedding(query, onEmbeddingMetrics);
  const sources = await listSources();

  if (sources.length === 0) {
    // No sources enumerated — fall back to a plain global search.
    const results = await searchWithPgVector(
      queryEmbedding,
      perSource * 4,
      "all",
    );
    return boostScoresByTags(results, query);
  }

  const searchSource = (source: string, limit: number) =>
    searchWithPgVector(queryEmbedding, limit, source as any).catch((err) => {
      console.error(
        `[Retrieval] balancedSearch source '${source}' failed:`,
        err,
      );
      return [] as SearchResult[];
    });

  // Stage 1: probe every source.
  const probeArrays = await Promise.all(
    sources.map((source) => searchSource(source, perSource)),
  );
  const probeRaw = probeArrays.flat();
  const probe = probeRaw.filter((r) => r.score >= minScore);
  // If the floor removed everything, keep the raw best so we never return empty.
  const probeKept = probe.length > 0 ? probe : probeRaw;

  // Determine winning sources: best-in-source within FOCUS_DELTA of global best.
  const maxBySource = new Map<string, number>();
  for (const r of probeKept) {
    const s = r.metadata.source ?? "unknown";
    maxBySource.set(s, Math.max(maxBySource.get(s) ?? 0, r.score));
  }
  const globalMax = Math.max(0, ...maxBySource.values());
  const winners = [...maxBySource.entries()]
    .filter(([, m]) => m >= globalMax - FOCUS_DELTA)
    .sort((a, b) => b[1] - a[1])
    .slice(0, FOCUS_MAX_SOURCES)
    .map(([s]) => s);

  // Stage 2: deepen the winning sources (single query filtered to those sources).
  let focus: SearchResult[] = [];
  if (FOCUS_LIMIT > 0 && winners.length > 0) {
    const focusResults = await searchWithPgVector(
      queryEmbedding,
      FOCUS_LIMIT,
      winners as any,
    ).catch((err) => {
      console.error("[Retrieval] balancedSearch focus stage failed:", err);
      return [] as SearchResult[];
    });
    focus = focusResults.filter((r) => r.score >= minScore);
  }

  const merged = dedupe([...probeKept, ...focus]);
  const boosted = await boostScoresByTags(merged, query);
  const capped = boosted.slice(0, MAX_TOTAL_CHUNKS);

  console.log(
    `[Retrieval] balancedSearch: ${sources.length} sources probed, winners=[${winners.join(", ")}], ${capped.length} chunks`,
  );
  return capped;
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
    // Using PostgreSQL pgvector for search
    const results = await searchWithPgVector(
      queryEmbedding,
      limit,
      sourceFilter,
      documentPath,
    );

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

          if (
            !fileRecord?.documentTags ||
            fileRecord.documentTags.length === 0
          ) {
            return result;
          }

          // Check if any tags match query terms
          const tags = fileRecord.documentTags.map((dt) =>
            dt.tag.name.toLowerCase(),
          );
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
          console.error(
            `Error boosting score for ${result.metadata.filePath}:`,
            error,
          );
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
