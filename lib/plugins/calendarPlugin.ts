import {
  DataSourcePlugin,
  DataSourceCapabilities,
  MetadataField,
  QueryParams,
  ToolDefinition,
  ScanResult,
} from "../dataSourceRegistry";
import { SearchResult } from "../retrieval";
import prisma from "../prisma";
import { syncCalendarEvents, indexCalendarEvents, getUpcomingEvents } from "../googleCalendar";

/**
 * Google Calendar data source plugin
 */
export class CalendarPlugin implements DataSourcePlugin {
  name = "google-calendar";
  displayName = "Google Calendar";

  capabilities: DataSourceCapabilities = {
    supportsMetadataQuery: true,
    supportsSemanticSearch: true,
    supportsScanning: true,
    requiresAuthentication: true,
  };

  getMetadataSchema(): MetadataField[] {
    return [
      {
        name: "eventTitle",
        displayName: "Event Title",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Title of the calendar event",
      },
      {
        name: "eventStartTime",
        displayName: "Start Time",
        type: "date",
        queryable: true,
        filterable: true,
        description: "Event start time",
      },
      {
        name: "eventEndTime",
        displayName: "End Time",
        type: "date",
        queryable: true,
        filterable: true,
        description: "Event end time",
      },
      {
        name: "eventLocation",
        displayName: "Location",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Event location",
      },
      {
        name: "eventAttendees",
        displayName: "Attendees",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Event attendees (comma-separated)",
      },
      {
        name: "calendarName",
        displayName: "Calendar Name",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Name of the calendar",
      },
    ];
  }

  async queryByMetadata(params: QueryParams): Promise<SearchResult[]> {
    const limit = params.limit && params.limit > 0 ? params.limit : 500;

    try {
      const where: any = {
        source: this.name,
      };

      // Date range filtering
      if (params.startDate || params.endDate) {
        where.eventStartTime = {};
        if (params.startDate) {
          where.eventStartTime.gte = new Date(params.startDate).toISOString();
        }
        if (params.endDate) {
          where.eventStartTime.lte = new Date(params.endDate).toISOString();
        }
      }

      // Location filtering
      if (params.location) {
        where.eventLocation = { contains: params.location };
      }

      // Attendee filtering
      if (params.attendee) {
        where.eventAttendees = { contains: params.attendee };
      }

      // Calendar name filtering
      if (params.calendarName) {
        where.calendarName = { contains: params.calendarName };
      }

      // Event title filtering
      if (params.eventTitle) {
        where.eventTitle = { contains: params.eventTitle };
      }

      const chunks = await prisma.documentChunk.findMany({
        where,
        take: limit,
        orderBy: { eventStartTime: "desc" },
      });

      return chunks.map((chunk) => ({
        content: chunk.content,
        metadata: {
          filePath: chunk.filePath,
          fileName: chunk.fileName,
          eventTitle: chunk.eventTitle || undefined,
          eventStartTime: chunk.eventStartTime || undefined,
          eventEndTime: chunk.eventEndTime || undefined,
          eventLocation: chunk.eventLocation || undefined,
          eventAttendees: chunk.eventAttendees || undefined,
          calendarName: chunk.calendarName || undefined,
        },
        score: 1.0,
      }));
    } catch (error) {
      console.error("[CalendarPlugin] Error querying by metadata:", error);
      return [];
    }
  }

  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: "search_calendar_by_date",
        description:
          "Search calendar events by date range. Use this to find events that happened or will happen in a specific time period. Returns all matching events from the indexed database.",
        parameters: [
          {
            name: "startDate",
            type: "string",
            required: false,
            description: "Start date in ISO format (YYYY-MM-DD) or natural language like 'last week'",
          },
          {
            name: "endDate",
            type: "string",
            required: false,
            description: "End date in ISO format (YYYY-MM-DD)",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description: "Maximum number of results to return (default: 500)",
          },
        ],
      },
      {
        name: "search_calendar_by_attendee",
        description:
          "Search calendar events by attendee name or email. Use this to find all events with a specific person. Returns all matching events from the indexed database.",
        parameters: [
          {
            name: "attendee",
            type: "string",
            required: true,
            description: "Attendee name or email to search for",
          },
          {
            name: "startDate",
            type: "string",
            required: false,
            description: "Optional start date filter (YYYY-MM-DD)",
          },
          {
            name: "endDate",
            type: "string",
            required: false,
            description: "Optional end date filter (YYYY-MM-DD)",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description: "Maximum number of results to return (default: 500)",
          },
        ],
      },
      {
        name: "search_calendar_by_location",
        description:
          "Search calendar events by location. Use this to find events at a specific place or venue.",
        parameters: [
          {
            name: "location",
            type: "string",
            required: true,
            description: "Location to search for (partial match)",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description: "Maximum number of results to return (default: 500)",
          },
        ],
      },
      {
        name: "get_upcoming_events",
        description:
          "Get upcoming events from Google Calendar (REAL-TIME from API, not indexed database). Use this for 'what's on my calendar today/this week' type queries. Supports flexible date ranges. Always returns fresh data.",
        parameters: [
          {
            name: "startDate",
            type: "string",
            required: false,
            description: "Start date in ISO format (YYYY-MM-DD). Defaults to current date/time.",
          },
          {
            name: "endDate",
            type: "string",
            required: false,
            description: "End date in ISO format (YYYY-MM-DD). If not provided, uses 'days' parameter instead.",
          },
          {
            name: "days",
            type: "number",
            required: false,
            description: "Number of days to look ahead from start date (default: 7). Only used if endDate is not provided.",
          },
        ],
        hasCustomExecution: true,
      },
    ];
  }

  async scan(options?: any): Promise<ScanResult> {
    try {
      console.log("[CalendarPlugin] Starting calendar scan...");

      // Sync events from Google
      const syncResult = await syncCalendarEvents();

      // Index events
      const indexed = await indexCalendarEvents();

      return {
        indexed,
        updated: syncResult.updated,
        deleted: 0,
      };
    } catch (error) {
      console.error("[CalendarPlugin] Error during scan:", error);
      return {
        indexed: 0,
        deleted: 0,
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  }

  async isConfigured(): Promise<boolean> {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
      });

      return !!(
        settings?.googleClientId &&
        settings?.googleClientSecret &&
        settings?.googleAccessToken &&
        settings?.googleSyncEnabled
      );
    } catch (error) {
      console.error("[CalendarPlugin] Error checking configuration:", error);
      return false;
    }
  }

  /**
   * Custom tool execution for tools with special handling
   */
  async executeTool(toolName: string, params: QueryParams): Promise<string> {
    if (toolName === "get_upcoming_events") {
      try {
        const events = await this.getUpcomingEventsRealtime(params);

        if (events.length === 0) {
          return "No upcoming events found in the specified time range.";
        }

        // Format events for LLM consumption
        const formattedEvents = events
          .map((event, index) => {
            let entry = `${index + 1}. **${event.title}**`;
            entry += `\n   📅 ${new Date(event.start).toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}`;

            if (event.end) {
              const endDate = new Date(event.end);
              const startDate = new Date(event.start);
              // Only show end time if it's different from start
              if (endDate.getTime() !== startDate.getTime()) {
                entry += ` - ${endDate.toLocaleString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}`;
              }
            }

            if (event.location) {
              entry += `\n   📍 ${event.location}`;
            }

            if (event.attendees) {
              entry += `\n   👥 ${event.attendees}`;
            }

            if (event.calendarName) {
              entry += `\n   📆 ${event.calendarName}`;
            }

            return entry;
          })
          .join("\n\n");

        return `Found ${events.length} upcoming event${events.length > 1 ? "s" : ""}:\n\n${formattedEvents}`;
      } catch (error) {
        console.error("[CalendarPlugin] Error executing get_upcoming_events:", error);
        return `Error fetching upcoming events: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    }

    throw new Error(`Unknown tool: ${toolName}`);
  }

  /**
   * Special method to handle real-time upcoming events query
   * This bypasses the indexed database and queries Google API directly
   */
  async getUpcomingEventsRealtime(params: { startDate?: string; endDate?: string; days?: number } = {}) {
    try {
      const { startDate, endDate, days = 7 } = params;

      const events = await getUpcomingEvents(days, startDate, endDate);

      // Format for LLM consumption
      return events.map((event) => {
        const startTime = event.start?.dateTime || event.start?.date;
        const endTime = event.end?.dateTime || event.end?.date;
        const attendees = event.attendees
          ? event.attendees.map((a: any) => a.email || a.displayName).join(", ")
          : "";

        return {
          title: event.summary || "(No title)",
          start: startTime,
          end: endTime,
          location: event.location || "",
          attendees,
          calendarName: event.calendarName,
          htmlLink: event.htmlLink,
        };
      });
    } catch (error) {
      console.error("[CalendarPlugin] Error fetching upcoming events:", error);
      throw error;
    }
  }
}

// Export singleton instance
export const calendarPlugin = new CalendarPlugin();
