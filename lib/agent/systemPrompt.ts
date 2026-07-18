import type { Channel } from "./types";

/**
 * Note appended for scheduled (reminder-triggered) runs so the agent doesn't
 * try to re-create the reminder that triggered it. Moved out of the route's
 * inline mutations.
 */
const SCHEDULED_NOTE =
  "This is a scheduled query execution triggered by a previously-created reminder. " +
  "Execute the query and return the results directly. Do NOT create new reminders or suggest creating reminders. " +
  "Simply answer the question or retrieve the requested information.";

/**
 * Build tool-usage guidance from the set of bound tool names. This replaces the
 * scattered inline `if (tools.some(...))` prompt mutations that used to live in
 * the chat route. Guidance is only included for tools that are actually bound.
 */
export function buildToolGuidance(toolNames: string[]): string {
  if (toolNames.length === 0) return "";

  const has = (name: string) => toolNames.includes(name);
  const hasAny = (pred: (n: string) => boolean) => toolNames.some(pred);

  let guidance =
    "You have access to tools. For general knowledge questions (jokes, definitions, math, common facts), " +
    "answer directly WITHOUT using any tools. " +
    "For questions about the user's personal data (their books, documents, calendar, files, notes), " +
    "use the search_knowledge_base tool to find relevant information. " +
    'To find documents ABOUT a topic (e.g. "my boat", "my Bayliner", "my insurance"), prefer ' +
    "search_knowledge_base — it does semantic search over document CONTENT and titles. Only use the " +
    "by-tag / by-correspondent / by-date plugin tools when the user gives an EXACT tag, sender, or date " +
    "to filter on; those do exact metadata matching and return nothing if the value is only in the title " +
    "or body. If a metadata search returns no results, fall back to search_knowledge_base. " +
    'When the user asks "how many" or wants to count items, use the appropriate search tool ' +
    "and TRUST THE TOOL'S COUNT RESULT. The tools query the FULL database and return ACCURATE counts. " +
    "You may call tools multiple times and chain them: search, read the result, then search again or " +
    "use another tool before giving your final answer. When you have enough information, answer directly " +
    "without calling further tools.";

  if (has("web_search")) {
    guidance +=
      " You have a web_search tool for looking up current events, news, weather, and real-time information. " +
      "Use it when the user asks about recent events, current facts, or anything that requires up-to-date information.";
  }
  if (has("deep_research")) {
    guidance +=
      " You have a deep_research tool for comprehensive, in-depth research on complex topics. " +
      "Use it when the user asks for thorough analysis, academic research, or detailed investigation of a subject.";
  }
  if (has("list_containers") || has("get_container_details")) {
    guidance +=
      " You have Docker/Portainer tools that can list containers, inspect container details, show resource usage (CPU/memory), " +
      "view logs, and check exposed ports. Use these when the user asks about their server, Docker containers, " +
      "running services, port usage, or container health.";
  }
  if (hasAny((n) => n.includes("email"))) {
    guidance +=
      " You also have email tools that can search, list, and manage emails across the user's connected accounts. " +
      "When the user asks about emails, inbox, unread messages, or wants to manage mail, ALWAYS use the email tools. " +
      "Never say you cannot access the user's email.";
  }
  if (hasAny((n) => n.startsWith("github_"))) {
    guidance +=
      " You have read-only GitHub tools: what's assigned to you, your open PRs, PRs awaiting your review, " +
      "listing your repositories, and per-repo activity (open PRs, count, last commit). Use them for any GitHub question.";
  }
  if (hasAny((n) => n.startsWith("todo_"))) {
    guidance +=
      " You have read-only Todo XP tools for the family's tasks: what's due today/overdue for the account owner (todo_today), " +
      "the upcoming week (todo_week), and the family roster + who's assigned which chores (todo_family). " +
      "For what a SPECIFIC family member (e.g. a kid) is assigned or needs to do, use todo_family with their name — it covers every " +
      "member. Only use todo_today for a person who has their own configured token (usually you).";
  }

  return guidance;
}

/**
 * Assemble the single canonical system prompt from composable sections. Replaces
 * the ~7 inline prompt mutations that used to be spread across the chat route.
 */
export function buildSystemPrompt(opts: {
  basePrompt: string;
  userContext: string;
  channel: Channel;
  toolNames: string[];
  isScheduled: boolean;
  matrixFormattingPrompt: string;
  webIntent?: "search" | "research";
}): string {
  let prompt = opts.basePrompt;

  if (opts.userContext) {
    prompt += `\n\n${opts.userContext}`;
  }

  // Matrix (and scheduled, which posts to Matrix) needs formatting guidance +
  // capability disclosure. Web renders full markdown so it is skipped there.
  if (opts.channel !== "web" && opts.matrixFormattingPrompt) {
    prompt += `\n\n${opts.matrixFormattingPrompt}`;
  }

  const guidance = buildToolGuidance(opts.toolNames);
  if (guidance) {
    prompt += `\n\n${guidance}`;
  }

  if (opts.webIntent === "search") {
    prompt +=
      "\n\nThe user explicitly requested a web search. Use the web_search tool for this query, then synthesize the results.";
  } else if (opts.webIntent === "research") {
    prompt +=
      "\n\nThe user explicitly requested in-depth research. Use the deep_research tool for this query, then synthesize the findings.";
  }

  if (opts.isScheduled) {
    prompt += `\n\n${SCHEDULED_NOTE}`;
  }

  return prompt;
}
