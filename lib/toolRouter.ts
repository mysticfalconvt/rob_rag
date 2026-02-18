/**
 * Tool Router - Intelligently selects which tools to make available based on query intent
 *
 * This reduces tool confusion by only presenting relevant tools to the LLM,
 * improving accuracy and reducing latency.
 */

export interface ToolRoutingResult {
  toolCategories: ToolCategory[];
  reasoning: string;
  suggestedTools?: string[]; // Specific tool names to prioritize
}

export type ToolCategory =
  | "calendar"           // Calendar queries (today, this week, upcoming)
  | "calendar_historical" // Past calendar queries (last month, previous week)
  | "counting"           // Count/total queries (how many books)
  | "reminders"          // Reminder creation/management
  | "notes"              // Note saving/retrieval
  | "metadata_search"    // Specific metadata searches (by date, attendee, etc.)
  | "all";               // General queries that might need multiple tools

/**
 * Analyze query and determine which tool categories are relevant
 */
export function routeToolSelection(query: string): ToolRoutingResult {
  const lowerQuery = query.toLowerCase();

  // Calendar-related patterns
  const calendarKeywords = /\b(calendar|schedule|meeting|appointment|event)\b/;
  const todayKeywords = /\b(today|today's|this morning|this afternoon|this evening)\b/;
  const upcomingKeywords = /\b(upcoming|next week|this week|tomorrow|later|soon)\b/;
  const historicalKeywords = /\b(last week|last month|previous|past|ago|yesterday)\b/;

  // Counting patterns
  const countingKeywords = /\b(how many|count|total|number of)\b/;

  // Reminder patterns
  const reminderKeywords = /\b(remind me|reminder|set a reminder|schedule|create reminder|list reminders|cancel reminder)\b/;

  // Note patterns
  const noteKeywords = /\b(save (that|this|it)|remember (this|that)|create a note|take a note|save as note)\b/;

  // Metadata search patterns
  const attendeeSearch = /\b(meetings? with|events? with|who attended)\b/;
  const locationSearch = /\b(events? at|meetings? at|at the location)\b/;
  const dateRangeSearch = /\b(between|from .* to|during|in (january|february|march|april|may|june|july|august|september|october|november|december))\b/;

  // Determine categories
  const categories: ToolCategory[] = [];
  const reasons: string[] = [];

  // Check for reminders first (high priority, specific action)
  if (reminderKeywords.test(lowerQuery)) {
    categories.push("reminders");
    reasons.push("detected reminder-related keywords");
  }

  // Check for notes (high priority, specific action)
  if (noteKeywords.test(lowerQuery)) {
    categories.push("notes");
    reasons.push("detected note-saving keywords");
  }

  // Check for counting queries
  if (countingKeywords.test(lowerQuery)) {
    categories.push("counting");
    reasons.push("detected counting query");

    // If counting calendar items, also include calendar search
    if (calendarKeywords.test(lowerQuery)) {
      categories.push("calendar_historical");
      reasons.push("counting calendar events");
    }
  }

  // Check for calendar queries
  if (calendarKeywords.test(lowerQuery) || todayKeywords.test(lowerQuery) || upcomingKeywords.test(lowerQuery)) {
    if (historicalKeywords.test(lowerQuery)) {
      categories.push("calendar_historical");
      reasons.push("detected historical calendar query");
    } else {
      categories.push("calendar");
      reasons.push("detected current/upcoming calendar query");
    }
  }

  // Check for specific metadata searches
  if (attendeeSearch.test(lowerQuery) || locationSearch.test(lowerQuery) || dateRangeSearch.test(lowerQuery)) {
    categories.push("metadata_search");
    reasons.push("detected metadata-specific search criteria");
  }

  // If no specific categories matched, use all tools
  if (categories.length === 0) {
    categories.push("all");
    reasons.push("general query, making all tools available");
  }

  // Generate tool name suggestions based on categories
  const suggestedTools: string[] = [];

  if (categories.includes("calendar")) {
    suggestedTools.push("get_upcoming_events");
  }
  if (categories.includes("calendar_historical") || categories.includes("metadata_search")) {
    suggestedTools.push("search_calendar_by_date");
  }
  if (categories.includes("reminders")) {
    suggestedTools.push("create_reminder", "list_reminders", "cancel_reminder");
  }
  if (categories.includes("notes")) {
    suggestedTools.push("save_assistant_response");
  }
  if (attendeeSearch.test(lowerQuery)) {
    suggestedTools.push("search_calendar_by_attendee");
  }
  if (locationSearch.test(lowerQuery)) {
    suggestedTools.push("search_calendar_by_location");
  }

  return {
    toolCategories: categories,
    reasoning: reasons.join(", "),
    suggestedTools: suggestedTools.length > 0 ? suggestedTools : undefined,
  };
}

/**
 * Filter tools based on routing result
 * Returns a subset of tools that are relevant to the query
 */
export function filterToolsByRouting(
  allTools: any[],
  routing: ToolRoutingResult
): any[] {
  // If routing says use all tools, return everything
  if (routing.toolCategories.includes("all")) {
    return allTools;
  }

  // If specific tools are suggested, prioritize those
  if (routing.suggestedTools && routing.suggestedTools.length > 0) {
    const filtered = allTools.filter(tool =>
      routing.suggestedTools!.includes(tool.name)
    );

    // If we got matches, return them; otherwise fall back to category-based filtering
    if (filtered.length > 0) {
      return filtered;
    }
  }

  // Filter by category
  const relevantToolNames = new Set<string>();

  for (const category of routing.toolCategories) {
    switch (category) {
      case "calendar":
        relevantToolNames.add("get_upcoming_events");
        break;

      case "calendar_historical":
        relevantToolNames.add("search_calendar_by_date");
        break;

      case "counting":
        // Include all search tools for counting
        allTools.forEach(tool => {
          if (tool.name.startsWith("search_") || tool.name.includes("_by_")) {
            relevantToolNames.add(tool.name);
          }
        });
        break;

      case "reminders":
        relevantToolNames.add("create_reminder");
        relevantToolNames.add("list_reminders");
        relevantToolNames.add("cancel_reminder");
        break;

      case "notes":
        relevantToolNames.add("save_assistant_response");
        break;

      case "metadata_search":
        relevantToolNames.add("search_calendar_by_date");
        relevantToolNames.add("search_calendar_by_attendee");
        relevantToolNames.add("search_calendar_by_location");
        break;
    }
  }

  // Return filtered tools
  const filtered = allTools.filter(tool => relevantToolNames.has(tool.name));

  // If filtering resulted in no tools, return all tools as fallback
  return filtered.length > 0 ? filtered : allTools;
}

/**
 * Get a human-readable explanation of why certain tools were selected
 */
export function explainToolSelection(routing: ToolRoutingResult, toolCount: number): string {
  const categoriesStr = routing.toolCategories.join(", ");
  return `[ToolRouter] Selected ${toolCount} tools for categories: ${categoriesStr} (${routing.reasoning})`;
}
