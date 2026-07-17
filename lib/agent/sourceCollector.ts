import type { SearchResult } from "../retrieval";
import type { AgentSource } from "./types";

/**
 * Accumulates sources reported by tools during a single agent run and dedupes
 * them. Replaces the single `ragSearchResults` variable in the old route so that
 * sources survive across multiple tool-calling iterations (e.g. two knowledge-base
 * searches, or a knowledge-base search plus a web search).
 */
export class SourceCollector {
  private sources: AgentSource[] = [];
  private seen = new Set<string>();

  private add(source: AgentSource): void {
    const key = `${source.filePath}::${(source.chunk || "").slice(0, 120)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.sources.push(source);
  }

  /** Add knowledge-base chunks (from the RAG tool's onSearchResults callback). */
  addRagResults(results: SearchResult[]): void {
    for (const r of results) {
      this.add({
        fileName: r.metadata.fileName,
        filePath: r.metadata.filePath,
        chunk: r.content,
        score: r.score,
        source: r.metadata.source || "synced",
      });
    }
  }

  /** Add web results (from web_search / deep_research tools). */
  addWebResults(
    results: Array<{
      title: string;
      url: string;
      snippet: string;
      score?: number;
    }>,
    sourceType: string,
  ): void {
    for (const r of results) {
      this.add({
        fileName: r.title,
        filePath: r.url,
        chunk: r.snippet,
        score: r.score || 0,
        source: sourceType,
      });
    }
  }

  getAll(): AgentSource[] {
    return this.sources;
  }
}
