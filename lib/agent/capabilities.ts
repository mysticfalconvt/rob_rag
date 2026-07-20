/**
 * Per-user capability catalog + enforcement helpers.
 *
 * A "capability" is a coarse group of tools (and, where relevant, the RAG
 * document sources they govern) that can be toggled on/off for an individual
 * Matrix user. This is intentionally coarser than individual tool names so the
 * config UI stays manageable (e.g. one "Paperless documents" checkbox instead
 * of one per search_paperless_* tool).
 *
 * Enforcement model:
 *  - `allowed = null`  -> allow everything (the default when a user has no policy
 *    row). Non-breaking: existing users are unaffected until an owner tightens
 *    them.
 *  - `allowed = Set`   -> only tools whose capability key is in the set are bound.
 *    Tools that belong to NO capability group (harmless date/time utilities) are
 *    always allowed.
 */

export interface CapabilityGroup {
  key: string;
  label: string;
  description: string;
  /** Exact tool names in this group. */
  tools?: string[];
  /** Tool-name prefixes in this group (matches any tool starting with these). */
  prefixes?: string[];
  /**
   * RAG document sources this group governs. When the group is denied, these
   * sources are excluded from `search_knowledge_base` results too (not just the
   * explicit plugin tools). Source ids match the `source` field on IndexedFile.
   */
  ragSources?: string[];
}

/** Every RAG document source id currently indexed into the vector store. */
export const ALL_RAG_SOURCES = [
  "paperless",
  "goodreads",
  "google-calendar",
  "uploaded",
  "synced",
  "local",
] as const;

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    key: "knowledge_base",
    label: "Knowledge base (document search)",
    description:
      "General semantic search across all indexed documents. Turning this off disables document search entirely for this user.",
    tools: ["search_knowledge_base"],
  },
  {
    key: "paperless",
    label: "Paperless documents",
    description:
      "Scanned/archived documents (bills, records, statements). Also removes Paperless content from knowledge-base search.",
    prefixes: ["search_paperless_"],
    ragSources: ["paperless"],
  },
  {
    key: "email",
    label: "Email",
    description: "Read, search, and manage email.",
    tools: [
      "search_email",
      "get_email_detail",
      "list_unread_email",
      "archive_email",
      "delete_email",
      "cleanup_old_email",
    ],
  },
  {
    key: "calendar",
    label: "Calendar",
    description:
      "Upcoming events and calendar search. Also governs calendar content in knowledge-base search.",
    tools: ["get_upcoming_events"],
    prefixes: ["search_calendar_"],
    ragSources: ["google-calendar"],
  },
  {
    key: "github",
    label: "GitHub",
    description: "Repositories, pull requests, commits, and reviews.",
    prefixes: ["github_"],
  },
  {
    key: "files",
    label: "Uploaded & synced files",
    description:
      "Files uploaded to the app or synced from disk. Also governs those files in knowledge-base search.",
    tools: ["search_uploaded_files", "search_files_by_type"],
    ragSources: ["uploaded", "synced", "local"],
  },
  {
    key: "goodreads",
    label: "Goodreads (reading)",
    description:
      "Books and reading history. Also governs book content in knowledge-base search.",
    prefixes: ["search_goodreads_"],
    ragSources: ["goodreads"],
  },
  {
    key: "weather",
    label: "Weather",
    description: "Current conditions and forecasts.",
    prefixes: ["weather_"],
  },
  {
    key: "docker",
    label: "Docker / infrastructure",
    description:
      "Container status, logs, stats, and exposed ports. Usually not appropriate for non-admin users.",
    tools: [
      "list_containers",
      "get_container_details",
      "get_container_logs",
      "get_container_stats",
      "list_exposed_ports",
    ],
  },
  {
    key: "todo",
    label: "Todo / tasks",
    description: "Family and personal todo lists.",
    prefixes: ["todo_"],
  },
  {
    key: "web",
    label: "Web search & research",
    description:
      "Live web search and deep research (also the #search / #research commands).",
    tools: ["web_search", "deep_research"],
  },
  {
    key: "reminders",
    label: "Reminders",
    description: "Create, list, and cancel scheduled reminders.",
    tools: ["create_reminder", "list_reminders", "cancel_reminder"],
  },
  {
    key: "assistant",
    label: "Notes, memory & skills",
    description:
      "Save/recall long-term memory, save/use skills, and save notes.",
    tools: [
      "save_memory",
      "recall_memory",
      "save_skill",
      "use_skill",
      "save_assistant_response",
    ],
  },
];

/** All capability keys, in catalog order. */
export const ALL_CAPABILITY_KEYS: string[] = CAPABILITY_GROUPS.map(
  (g) => g.key,
);

/** Find the capability group a tool belongs to, or null if uncategorized. */
function groupForTool(toolName: string): CapabilityGroup | null {
  for (const g of CAPABILITY_GROUPS) {
    if (g.tools?.includes(toolName)) return g;
    if (g.prefixes?.some((p) => toolName.startsWith(p))) return g;
  }
  return null;
}

/**
 * Whether a tool is permitted. `allowed = null` means allow everything.
 * Tools that belong to no capability group (date/time utilities) are always
 * allowed.
 */
export function isToolAllowed(
  toolName: string,
  allowed: Set<string> | null,
): boolean {
  if (!allowed) return true;
  const g = groupForTool(toolName);
  if (!g) return true;
  return allowed.has(g.key);
}

/** Filter a tool list by allowed capabilities (null = no filtering). */
export function filterToolsByCapabilities<T extends { name: string }>(
  tools: T[],
  allowed: Set<string> | null,
): T[] {
  if (!allowed) return tools;
  return tools.filter((t) => isToolAllowed(t.name, allowed));
}

/**
 * Compute the RAG `sourceFilter` override implied by a user's capabilities.
 *  - "none"      -> disable RAG entirely (knowledge_base capability denied)
 *  - undefined   -> no restriction (every governed source is permitted)
 *  - string[]    -> restrict knowledge-base search to these sources
 *
 * `allowed = null` returns undefined (no restriction).
 */
export function ragSourceFilterForCapabilities(
  allowed: Set<string> | null,
): "none" | string[] | undefined {
  if (!allowed) return undefined;
  if (!allowed.has("knowledge_base")) return "none";

  const deniedSources = new Set<string>();
  for (const g of CAPABILITY_GROUPS) {
    if (g.ragSources?.length && !allowed.has(g.key)) {
      for (const s of g.ragSources) deniedSources.add(s);
    }
  }
  if (deniedSources.size === 0) return undefined; // nothing to restrict

  const permitted = (ALL_RAG_SOURCES as readonly string[]).filter(
    (s) => !deniedSources.has(s),
  );
  // Knowledge base is on but every governed source is denied -> effectively no
  // searchable content, so disable RAG rather than pass an empty filter.
  return permitted.length === 0 ? "none" : permitted;
}
