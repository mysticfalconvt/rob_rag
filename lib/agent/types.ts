import type { SourceCollector } from "./sourceCollector";

/**
 * Which entry point invoked the agent. This replaces the old `triggerSource`
 * string and the separate `/api/chat-direct` endpoint — every caller now goes
 * through the same orchestrator and only differs by channel.
 */
export type Channel = "web" | "matrix" | "scheduled";

/**
 * A normalized source used for citation in the UI and Matrix formatting.
 * Both knowledge-base chunks and web results are coerced into this shape.
 */
export interface AgentSource {
  fileName: string;
  filePath: string;
  chunk: string;
  score: number;
  source: string;
  relevanceScore?: number;
  isReferenced?: boolean;
}

export interface AgentUserProfile {
  userName: string | null;
  userBio: string | null;
  userPreferences: unknown;
}

export interface RunAgentInput {
  /** Full turn history including the latest user message (last element). */
  messages: { role: "user" | "assistant"; content: string }[];
  channel: Channel;
  /** Resolved real AuthUser id (never "system" — Matrix senders are resolved to real rows). */
  userId: string;
  userProfile: AgentUserProfile;

  /**
   * Existing conversation id, or null to resolve/create one.
   * Web new-chat passes null; Matrix/scheduler pass the room-scoped conversation.
   */
  conversationId?: string | null;

  // Behaviour overrides — "mode" is now decided by the agent, these are just
  // capability constraints the caller can impose.
  /** When true, no tools are bound (a plain LLM turn). */
  disableTools?: boolean;
  /** UI source scoping. "none" disables the RAG tool specifically. */
  sourceFilter?: string | string[];
  sourceCount?: number;
  /** Chat scoped to a single document. */
  documentPath?: string | null;

  /** Matrix room id — needed for reminder tools and conversation scoping. */
  matrixRoomId?: string;

  /**
   * Explicit web intent from the `#search` / `#research` commands. Rather than a
   * bespoke pre-pass, this nudges the agent to call the corresponding web tool.
   * (There is no general "web on/off" toggle — the agent decides when to search
   * the web via the always-bound web_search / deep_research tools.)
   */
  webIntent?: "search" | "research";

  /** Streaming callback for final-answer tokens. */
  onToken?: (delta: string) => void | Promise<void>;
}

export interface RunAgentResult {
  text: string;
  sources: AgentSource[];
  conversationId: string | null;
}

/** Shape carried on RunnableConfig.configurable and consumed by tools. */
export interface AgentToolConfigurable {
  matrixRoomId?: string;
  conversationHistory: { role: string; content: string }[];
  userId: string;
  originalQuery: string;
  sourceCollector: SourceCollector;
}
