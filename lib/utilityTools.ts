import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Generate utility tools for common operations like date/time calculations
 */
export function generateUtilityTools(): DynamicStructuredTool[] {
  return [
    createCurrentDateTimeTool(),
    createDateCalculationTool(),
    createDateDifferenceTool(),
  ];
}

/**
 * Tool to get current date and time in various formats
 */
function createCurrentDateTimeTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "get_current_datetime",
    description:
      "Get the current date and time in America/New_York timezone (EST/EDT). Useful for answering questions about 'today', 'now', 'current time', etc.",
    schema: z.object({
      format: z
        .enum(["iso", "date", "time", "datetime", "timestamp"])
        .default("datetime")
        .describe(
          "Output format: 'iso' (ISO 8601), 'date' (YYYY-MM-DD), 'time' (HH:MM:SS), 'datetime' (readable date and time), 'timestamp' (Unix milliseconds)",
        ),
      timezone: z
        .string()
        .optional()
        .describe(
          "Optional timezone (e.g., 'America/New_York', 'America/Los_Angeles', 'Europe/London'). Defaults to America/New_York (EST/EDT).",
        ),
    }),
    func: async ({ format, timezone }) => {
      try {
        const now = new Date();
        // Default to America/New_York if no timezone specified
        const tz = timezone || "America/New_York";

        let result: string;
        switch (format) {
          case "iso":
            // For ISO, show the time in the specified timezone
            result = now.toLocaleString("en-US", {
              timeZone: tz,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            }).replace(/(\d+)\/(\d+)\/(\d+),\s(\d+):(\d+):(\d+)/, "$3-$1-$2T$4:$5:$6");
            break;
          case "date":
            result = now.toLocaleDateString("en-CA", { timeZone: tz }); // en-CA gives YYYY-MM-DD
            break;
          case "time":
            result = now.toLocaleTimeString("en-US", {
              timeZone: tz,
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            break;
          case "timestamp":
            result = now.getTime().toString();
            break;
          case "datetime":
          default:
            result = now.toLocaleString("en-US", {
              timeZone: tz,
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
        }

        // Get timezone abbreviation (EST/EDT, PST/PDT, etc.)
        const tzAbbr = now.toLocaleTimeString("en-US", {
          timeZone: tz,
          timeZoneName: "short",
        }).split(" ").pop();

        return JSON.stringify({
          success: true,
          currentDateTime: result,
          format,
          timezone: tz,
          timezoneAbbr: tzAbbr,
          timestamp: now.getTime(),
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  });
}

/**
 * Tool to calculate dates (add/subtract days, months, years)
 */
function createDateCalculationTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "calculate_date",
    description:
      "Calculate a date by adding or subtracting days, weeks, months, or years from a given date. Useful for questions like 'what's 90 days from now' or 'what was the date 2 weeks ago'.",
    schema: z.object({
      startDate: z
        .string()
        .optional()
        .describe(
          "Starting date in YYYY-MM-DD format. If not provided, uses current date.",
        ),
      operation: z
        .enum(["add", "subtract"])
        .describe("Whether to add or subtract time"),
      amount: z.number().int().positive().describe("Amount to add/subtract"),
      unit: z
        .enum(["days", "weeks", "months", "years"])
        .describe("Unit of time to add/subtract"),
    }),
    func: async ({ startDate, operation, amount, unit }) => {
      try {
        const start = startDate ? new Date(startDate) : new Date();

        // Validate start date
        if (isNaN(start.getTime())) {
          return JSON.stringify({
            success: false,
            error: "Invalid start date format. Use YYYY-MM-DD",
          });
        }

        const result = new Date(start);
        const multiplier = operation === "add" ? 1 : -1;
        const value = amount * multiplier;

        switch (unit) {
          case "days":
            result.setDate(result.getDate() + value);
            break;
          case "weeks":
            result.setDate(result.getDate() + value * 7);
            break;
          case "months":
            result.setMonth(result.getMonth() + value);
            break;
          case "years":
            result.setFullYear(result.getFullYear() + value);
            break;
        }

        return JSON.stringify({
          success: true,
          startDate: start.toISOString().split("T")[0],
          resultDate: result.toISOString().split("T")[0],
          operation: `${operation} ${amount} ${unit}`,
          readableResult: result.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  });
}

/**
 * Tool to calculate the difference between two dates
 */
function createDateDifferenceTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "calculate_date_difference",
    description:
      "Calculate the difference between two dates. Returns the difference in days, weeks, months, and years. Useful for questions like 'how many days until Christmas' or 'how long ago was that date'.",
    schema: z.object({
      startDate: z.string().describe("First date in YYYY-MM-DD format"),
      endDate: z
        .string()
        .optional()
        .describe(
          "Second date in YYYY-MM-DD format. If not provided, uses current date.",
        ),
      unit: z
        .enum(["days", "weeks", "months", "years", "all"])
        .default("all")
        .describe("Unit to return the difference in, or 'all' for all units"),
    }),
    func: async ({ startDate, endDate, unit }) => {
      try {
        const start = new Date(startDate);
        const end = endDate ? new Date(endDate) : new Date();

        // Validate dates
        if (isNaN(start.getTime())) {
          return JSON.stringify({
            success: false,
            error: "Invalid start date format. Use YYYY-MM-DD",
          });
        }
        if (isNaN(end.getTime())) {
          return JSON.stringify({
            success: false,
            error: "Invalid end date format. Use YYYY-MM-DD",
          });
        }

        // Calculate difference in milliseconds
        const diffMs = Math.abs(end.getTime() - start.getTime());

        // Convert to different units
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffWeeks = Math.floor(diffDays / 7);
        const diffMonths = Math.floor(diffDays / 30.44); // Average month length
        const diffYears = Math.floor(diffDays / 365.25); // Account for leap years

        // Determine direction
        const direction = end.getTime() > start.getTime() ? "future" : "past";

        const result: any = {
          success: true,
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
          direction,
        };

        if (unit === "all") {
          result.difference = {
            days: diffDays,
            weeks: diffWeeks,
            months: diffMonths,
            years: diffYears,
          };
          result.readable = `${diffDays} days (${diffWeeks} weeks, ${diffMonths} months, ${diffYears} years)`;
        } else {
          let value: number;
          switch (unit) {
            case "days":
              value = diffDays;
              break;
            case "weeks":
              value = diffWeeks;
              break;
            case "months":
              value = diffMonths;
              break;
            case "years":
              value = diffYears;
              break;
            default:
              value = diffDays;
          }
          result.difference = value;
          result.unit = unit;
          result.readable = `${value} ${unit}`;
        }

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  });
}
