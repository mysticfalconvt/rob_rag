import { HumanMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import { getFastChatModel } from "../ai";
import { config as appConfig } from "../config";
import prisma from "../prisma";

/**
 * Convert a natural-language time expression into a 5-field cron expression using
 * the LLM. Handles arbitrary phrasings the keyword parser can't ("every other
 * day", "first of the month", "weekdays at 6:30"). Returns null on any failure so
 * the caller can fall back to the deterministic keyword parser.
 *
 * The cron is interpreted in the user's timezone (the scheduler parses it with
 * the same tz). For one-time reminders we ask for specific day-of-month + month
 * fields, which the scheduler already detects and disables after firing.
 */
async function timeExpressionToCronViaLLM(
  timeStr: string,
): Promise<{ cron: string; description: string } | null> {
  try {
    const nowLocal = new Date().toLocaleString("en-US", {
      timeZone: appConfig.USER_TIMEZONE,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const prompt = `Convert a reminder's timing into a standard 5-field cron expression (minute hour day-of-month month day-of-week), interpreted in the local timezone.

Current local date/time: ${nowLocal} (timezone: ${appConfig.USER_TIMEZONE}).

Rules:
- RECURRING schedules use * for fields that vary. Examples:
  - "every morning at 7am" -> "0 7 * * *"
  - "weekdays at 6:30pm" -> "30 18 * * 1-5"
  - "every Monday at 9am" -> "0 9 * * 1"
  - "every other day at 8" -> "0 8 */2 * *"
  - "first of the month at noon" -> "0 12 1 * *"
- ONE-TIME reminders (e.g. "tomorrow at 8am", "in 15 minutes", "July 20 at noon"): compute the exact target date/time relative to the current local date/time above, and output SPECIFIC day-of-month and month numbers with * for day-of-week. Example (if today were July 19): "tomorrow at 8am" -> "0 8 20 7 *".
- If no time of day is given, default to 08:00.
- Use 24-hour values in the cron.

Reminder timing: "${timeStr}"

Respond with ONLY a compact JSON object, no prose:
{"cron":"<minute hour day-of-month month day-of-week>","description":"<short human description>"}`;

    const model = await getFastChatModel();
    const resp = await model.invoke([new HumanMessage(prompt)]);
    const text = typeof resp.content === "string" ? resp.content : "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const obj = JSON.parse(match[0]);
    if (!obj?.cron || typeof obj.cron !== "string") return null;
    const cron = obj.cron.trim();

    // Must be a valid 5-field cron; validate by parsing in the user's tz.
    if (cron.split(/\s+/).length !== 5) return null;
    CronExpressionParser.parse(cron, { tz: appConfig.USER_TIMEZONE });

    const description =
      typeof obj.description === "string" && obj.description.trim()
        ? obj.description.trim()
        : cron;
    return { cron, description };
  } catch (error) {
    console.error(
      "[ReminderTool] LLM cron generation failed, will fall back:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Parse natural language time expressions into cron expressions
 */
function parseTimeExpression(timeStr: string): {
  cron: string;
  description: string;
} {
  const lower = timeStr.toLowerCase().trim();

  // Extract time if specified
  let hour = 8; // default 8am
  let minute = 0;

  const timeMatch = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;

    if (timeMatch[3]) {
      const isPM = timeMatch[3].toLowerCase() === "pm";
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
    }
  }

  // Check for relative time expressions (in X minutes/hours)
  const relativeMatch = lower.match(
    /in\s+(\d+)\s+(min|minute|minutes|hour|hours)/i,
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();

    const now = new Date();
    if (unit.startsWith("min")) {
      now.setMinutes(now.getMinutes() + amount);
    } else if (unit.startsWith("hour")) {
      now.setHours(now.getHours() + amount);
    }

    // Convert to local time for cron expression
    const localTime = new Date(
      now.toLocaleString("en-US", { timeZone: appConfig.USER_TIMEZONE }),
    );

    // Create a one-time cron for this specific time (in user's local timezone)
    return {
      cron: `${localTime.getMinutes()} ${localTime.getHours()} ${localTime.getDate()} ${localTime.getMonth() + 1} *`,
      description: `In ${amount} ${unit} (at ${localTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })})`,
    };
  }

  // Parse recurrence patterns
  if (lower.includes("every day") || lower.includes("daily")) {
    return {
      cron: `${minute} ${hour} * * *`,
      description: `Daily at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("every morning")) {
    return {
      cron: `0 ${hour} * * *`,
      description: `Every morning at ${hour}:00`,
    };
  }

  if (lower.includes("every evening")) {
    const eveningHour = 18; // 6pm default
    return {
      cron: `0 ${eveningHour} * * *`,
      description: `Every evening at ${eveningHour}:00`,
    };
  }

  if (lower.includes("every monday") || lower.includes("mondays")) {
    return {
      cron: `${minute} ${hour} * * 1`,
      description: `Every Monday at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("every tuesday") || lower.includes("tuesdays")) {
    return {
      cron: `${minute} ${hour} * * 2`,
      description: `Every Tuesday at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("every wednesday") || lower.includes("wednesdays")) {
    return {
      cron: `${minute} ${hour} * * 3`,
      description: `Every Wednesday at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("every thursday") || lower.includes("thursdays")) {
    return {
      cron: `${minute} ${hour} * * 4`,
      description: `Every Thursday at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("every friday") || lower.includes("fridays")) {
    return {
      cron: `${minute} ${hour} * * 5`,
      description: `Every Friday at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("every saturday") || lower.includes("saturdays")) {
    return {
      cron: `${minute} ${hour} * * 6`,
      description: `Every Saturday at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("every sunday") || lower.includes("sundays")) {
    return {
      cron: `${minute} ${hour} * * 0`,
      description: `Every Sunday at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("weekday") || lower.includes("weekdays")) {
    return {
      cron: `${minute} ${hour} * * 1-5`,
      description: `Weekdays at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("every week")) {
    return {
      cron: `${minute} ${hour} * * 0`,
      description: `Weekly on Sunday at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("every hour")) {
    return {
      cron: `${minute} * * * *`,
      description: `Every hour at :${minute.toString().padStart(2, "0")}`,
    };
  }

  // One-time reminders — use local date so "tomorrow" means tomorrow in user's timezone
  const nowLocal = new Date(
    new Date().toLocaleString("en-US", { timeZone: appConfig.USER_TIMEZONE }),
  );

  if (lower.includes("tomorrow")) {
    const tomorrow = new Date(nowLocal);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return {
      cron: `${minute} ${hour} ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`,
      description: `Tomorrow at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  if (lower.includes("today") || lower.includes("later today")) {
    return {
      cron: `${minute} ${hour} ${nowLocal.getDate()} ${nowLocal.getMonth() + 1} *`,
      description: `Today at ${hour}:${minute.toString().padStart(2, "0")}`,
    };
  }

  // Default to daily at specified time
  return {
    cron: `${minute} ${hour} * * *`,
    description: `Daily at ${hour}:${minute.toString().padStart(2, "0")}`,
  };
}

/**
 * Tool to create scheduled reminders
 */
export const createReminderTool = new DynamicStructuredTool({
  name: "create_reminder",
  description: `Create a scheduled reminder that will be sent to the current conversation at a specified time.
Use this when the user asks to be reminded about something, or wants to schedule a recurring query.
This tool creates the reminder immediately.

CRITICAL: The "query" field will be sent to the chat system later AS IF a user typed it fresh.
You MUST rewrite the user's request into a clean, standalone question or instruction.
- Do NOT include words like "remind", "reminder", "schedule", or time references (e.g., "at 7am", "tomorrow").
- Do NOT repeat the user's phrasing verbatim — rephrase it as a direct question or action.
- For knowledge retrieval (books, documents, calendar, emails), phrase as a clear search question.
- For simple tasks, use a short imperative (e.g., "call mom", "take out trash").

Examples of user request → query transformation:
- User: "At 7:29am check my latest books I am reading in good reads and tell me something about them"
  → query: "What are my latest books on Goodreads? Tell me something interesting about each one."
- User: "Remind me Tuesday at 2PM with the events in my calendar for the day"
  → query: "What are my calendar events for today?"
- User: "Every morning at 7am, tell me what's on my calendar"
  → query: "What is on my calendar today?"
- User: "Remind me tomorrow at 8am to check my email"
  → query: "check email" (simple task)
- User: "Every Friday at 5pm to review my week"
  → query: "What happened this week? Summarize my calendar events and documents."
- User: "Every weekday at 9am, show me unread Paperless documents"
  → query: "What are my recent unread Paperless documents?"`,
  schema: z.object({
    time_expression: z
      .string()
      .describe(
        "When to send the reminder (e.g., 'tomorrow at 8am', 'in 15 minutes', 'every morning at 7am', 'every Friday at 5pm')",
      ),
    query: z
      .string()
      .describe(
        "A clean, standalone question or instruction to execute when the reminder fires. Rewrite the user's request — do NOT include 'remind', 'reminder', 'schedule', or time references. For knowledge retrieval, phrase as a direct question. For simple tasks, use an imperative.",
      ),
    name: z
      .string()
      .optional()
      .describe(
        "Optional short name for the reminder (e.g., 'Daily calendar check', 'Book reflection')",
      ),
  }),
  func: async ({ time_expression, query, name }, config) => {
    try {
      // Get Matrix room ID from config if available
      const matrixRoomId = (config as any)?.configurable?.matrixRoomId;

      if (!matrixRoomId) {
        return "❌ Cannot create reminder: This feature is only available in Matrix conversations. Please use the /scheduled page in the web interface to create reminders.";
      }

      // Parse the time expression — LLM first (handles arbitrary phrasings),
      // falling back to the deterministic keyword parser if the LLM output is
      // unusable or the model is unavailable.
      const { cron, description } =
        (await timeExpressionToCronViaLLM(time_expression)) ||
        parseTimeExpression(time_expression);

      // Validate cron expression and get next run time (interpret cron in user's timezone)
      let nextRun: Date;
      try {
        const interval = CronExpressionParser.parse(cron, {
          tz: appConfig.USER_TIMEZONE,
        });
        nextRun = interval.next().toDate();
      } catch (error) {
        return `❌ I couldn't parse the time expression "${time_expression}".

Error: ${error instanceof Error ? error.message : "Unknown error"}

Please try rephrasing, for example:
- "tomorrow at 8am"
- "in 30 minutes"
- "every morning at 7am"
- "every Friday at 5pm"`;
      }

      // Generate a name if not provided
      const taskName =
        name || `${query.substring(0, 50)}${query.length > 50 ? "..." : ""}`;

      // Always create immediately - remove confirmation step to reduce LLM calls
      // The LLM can explain what it's doing in its response

      // Determine if this is a simple notification or a query
      // Simple notifications are action reminders like "take chicken out", "call mom"
      // Queries should use RAG to pull from knowledge base
      const lowerQuery = query.toLowerCase();

      // Check if query asks for information or references knowledge
      const asksForInfo = lowerQuery.match(
        /\b(what|how many|list|show|tell me|give me|find|search|remind me about|think about|remember)\b/,
      );
      const referencesKnowledge = lowerQuery.match(
        /\b(books?|documents?|calendar|email|papers?|read|wrote|goodreads|files?)\b/,
      );

      // Use RAG flow if it asks for info OR references stored knowledge
      const isQuery = asksForInfo || referencesKnowledge;

      // For simple reminders, prepend with a notification marker
      const finalQuery = isQuery ? query : `SIMPLE_REMINDER: ${query}`;

      // Confirmed - create the scheduled task
      const task = await prisma.scheduledTask.create({
        data: {
          type: "matrix_reminder",
          name: taskName,
          schedule: cron,
          enabled: true,
          query: finalQuery,
          matrixRoomId,
          nextRun,
        },
      });

      const formattedNextRun = nextRun.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: appConfig.USER_TIMEZONE,
      });

      return `✅ **Reminder Created!**

• **Name:** ${taskName}
• **Schedule:** ${description}
• **Next run:** ${formattedNextRun}

I'll send you a message in this room when it's time. You can manage all your reminders at the /scheduled page in the web interface.`;
    } catch (error) {
      console.error("[ReminderTool] Error creating reminder:", error);
      return `❌ Failed to create reminder: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});

/**
 * Tool to list scheduled reminders for the current conversation
 */
export const listRemindersTool = new DynamicStructuredTool({
  name: "list_reminders",
  description:
    "List all scheduled reminders for the current conversation. Use this when the user asks what reminders they have or wants to see their scheduled tasks.",
  schema: z.object({
    include_disabled: z
      .boolean()
      .optional()
      .describe("Whether to include disabled reminders (default: false)"),
  }),
  func: async ({ include_disabled }, config) => {
    try {
      const matrixRoomId = (config as any)?.configurable?.matrixRoomId;

      if (!matrixRoomId) {
        return "This feature is only available in Matrix conversations. Please visit /scheduled in the web interface to see all reminders.";
      }

      const where: any = {
        type: "matrix_reminder",
        matrixRoomId,
      };

      if (!include_disabled) {
        where.enabled = true;
      }

      const reminders = await prisma.scheduledTask.findMany({
        where,
        orderBy: { nextRun: "asc" },
      });

      if (reminders.length === 0) {
        return "You don't have any scheduled reminders in this room yet. Use create_reminder to set one up!";
      }

      let response = `📅 **Your Scheduled Reminders (${reminders.length})**\n\n`;

      for (const reminder of reminders) {
        const status = reminder.enabled ? "✅ Active" : "⏸️ Paused";
        const nextRun = reminder.nextRun
          ? new Date(reminder.nextRun).toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
              timeZone: appConfig.USER_TIMEZONE,
            })
          : "Not scheduled";

        response += `**${reminder.name}**\n`;
        response += `• ${status}\n`;
        response += `• Will ask: "${reminder.query}"\n`;
        response += `• Next: ${nextRun}\n`;

        if (reminder.lastRun) {
          const lastRun = new Date(reminder.lastRun).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
          const lastStatus = reminder.lastRunStatus === "success" ? "✅" : "❌";
          response += `• Last: ${lastRun} ${lastStatus}\n`;
        }

        response += `\n`;
      }

      response += "💡 Manage all reminders at /scheduled in the web interface.";

      return response;
    } catch (error) {
      console.error("[ReminderTool] Error listing reminders:", error);
      return `❌ Failed to list reminders: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});

/**
 * Tool to cancel/delete a scheduled reminder
 */
export const cancelReminderTool = new DynamicStructuredTool({
  name: "cancel_reminder",
  description:
    "Cancel or delete a scheduled reminder. Use this when the user wants to stop or remove a reminder.",
  schema: z.object({
    reminder_name: z
      .string()
      .describe("The name of the reminder to cancel (must match exactly)"),
  }),
  func: async ({ reminder_name }, config) => {
    try {
      const matrixRoomId = (config as any)?.configurable?.matrixRoomId;

      if (!matrixRoomId) {
        return "This feature is only available in Matrix conversations. Please visit /scheduled in the web interface to manage reminders.";
      }

      // Find the reminder
      const reminder = await prisma.scheduledTask.findFirst({
        where: {
          type: "matrix_reminder",
          matrixRoomId,
          name: reminder_name,
        },
      });

      if (!reminder) {
        return `❌ Reminder "${reminder_name}" not found. Use list_reminders to see your active reminders.`;
      }

      // Delete the reminder
      await prisma.scheduledTask.delete({
        where: { id: reminder.id },
      });

      return `✅ Reminder "${reminder_name}" has been cancelled and deleted.`;
    } catch (error) {
      console.error("[ReminderTool] Error cancelling reminder:", error);
      return `❌ Failed to cancel reminder: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});
