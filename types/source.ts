export interface Source {
  fileName: string;
  filePath: string;
  chunk: string;
  score: number;
  source: string;
  relevanceScore?: number;
  isReferenced?: boolean;
}

/** Human-readable display names and icons for source types */
const SOURCE_DISPLAY: Record<string, { label: string; icon: string }> = {
  goodreads: { label: "Goodreads", icon: "📚" },
  paperless: { label: "Paperless", icon: "🗂️" },
  "google-calendar": { label: "Calendar", icon: "📅" },
  uploaded: { label: "Uploaded", icon: "📤" },
  synced: { label: "Synced Files", icon: "🔄" },
  web_search: { label: "Web Search", icon: "🌐" },
  web_research: { label: "Deep Research", icon: "🔬" },
};

export function getSourceDisplayName(source: string): string {
  return SOURCE_DISPLAY[source]?.label || source;
}

export function getSourceIcon(source: string): string {
  return SOURCE_DISPLAY[source]?.icon || "🔄";
}
