import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import prisma from "../prisma";
import { CronExpressionParser } from "cron-parser";

/**
 * Parse natural language time expressions into cron expressions
 */
function parseTimeExpression(timeStr: string): { cron: string; description: string } {
  const lower = timeStr.toLowerCase().trim();

  // Extract time if specified
  let hour = 8; // default 8am
  let minute = 0;

  const timeMatch = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;

    if (timeMatch[3]) {
      const isPM = timeMatch[3].toLowerCase() === 'pm';
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
    }
  }

  // Check for relative time expressions (in X minutes/hours)
  const relativeMatch = lower.match(/in\s+(\d+)\s+(min|minute|minutes|hour|hours)/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();

    const now = new Date();
    if (unit.startsWith('min')) {
      now.setMinutes(now.getMinutes() + amount);
    } else if (unit.startsWith('hour')) {
      now.setHours(now.getHours() + amount);
    }

    // Create a one-time cron for this specific time
    return {
      cron: `${now.getMinutes()} ${now.getHours()} ${now.getDate()} ${now.getMonth() + 1} *`,
      description: `In ${amount} ${unit} (at ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })})`
    };
  }

  // Parse recurrence patterns
  if (lower.includes('every day') || lower.includes('daily')) {
    return {
      cron: `${minute} ${hour} * * *`,
      description: `Daily at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('every morning')) {
    return {
      cron: `0 ${hour} * * *`,
      description: `Every morning at ${hour}:00`
    };
  }

  if (lower.includes('every evening')) {
    const eveningHour = 18; // 6pm default
    return {
      cron: `0 ${eveningHour} * * *`,
      description: `Every evening at ${eveningHour}:00`
    };
  }

  if (lower.includes('every monday') || lower.includes('mondays')) {
    return {
      cron: `${minute} ${hour} * * 1`,
      description: `Every Monday at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('every tuesday') || lower.includes('tuesdays')) {
    return {
      cron: `${minute} ${hour} * * 2`,
      description: `Every Tuesday at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('every wednesday') || lower.includes('wednesdays')) {
    return {
      cron: `${minute} ${hour} * * 3`,
      description: `Every Wednesday at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('every thursday') || lower.includes('thursdays')) {
    return {
      cron: `${minute} ${hour} * * 4`,
      description: `Every Thursday at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('every friday') || lower.includes('fridays')) {
    return {
      cron: `${minute} ${hour} * * 5`,
      description: `Every Friday at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('every saturday') || lower.includes('saturdays')) {
    return {
      cron: `${minute} ${hour} * * 6`,
      description: `Every Saturday at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('every sunday') || lower.includes('sundays')) {
    return {
      cron: `${minute} ${hour} * * 0`,
      description: `Every Sunday at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('weekday') || lower.includes('weekdays')) {
    return {
      cron: `${minute} ${hour} * * 1-5`,
      description: `Weekdays at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('every week')) {
    return {
      cron: `${minute} ${hour} * * 0`,
      description: `Weekly on Sunday at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('every hour')) {
    return {
      cron: `${minute} * * * *`,
      description: `Every hour at :${minute.toString().padStart(2, '0')}`
    };
  }

  // One-time reminders
  if (lower.includes('tomorrow')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(hour, minute, 0, 0);

    return {
      cron: `${minute} ${hour} ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`,
      description: `Tomorrow at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  if (lower.includes('today') || lower.includes('later today')) {
    const today = new Date();
    return {
      cron: `${minute} ${hour} ${today.getDate()} ${today.getMonth() + 1} *`,
      description: `Today at ${hour}:${minute.toString().padStart(2, '0')}`
    };
  }

  // Default to daily at specified time
  return {
    cron: `${minute} ${hour} * * *`,
    description: `Daily at ${hour}:${minute.toString().padStart(2, '0')}`
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

IMPORTANT: For reminders that involve knowledge retrieval (books, documents, calendar, emails, etc.),
write the query as a question or search request so the RAG system can find relevant information.

Examples:
- "Remind me tomorrow at 8am to check my email" → query: "check email" (simple reminder)
- "Every morning at 7am, tell me what's on my calendar" → query: "what's on my calendar today?" (uses RAG)
- "Remind me about books I've read" → query: "show me some interesting books from my reading history" (uses RAG with Goodreads)
- "Every Friday at 5pm to review my week" → query: "what happened this week?" (uses RAG with calendar/documents)
- "Every weekday at 9am, show me unread Paperless documents" → query: "what are my recent unread documents?" (uses RAG)`,
  schema: z.object({
    time_expression: z.string().describe("When to send the reminder (e.g., 'tomorrow at 8am', 'in 15 minutes', 'every morning at 7am', 'every Friday at 5pm')"),
    query: z.string().describe("The question or query to run when the reminder triggers. For knowledge retrieval (books, documents, calendar), phrase as a search question. For simple tasks, use an imperative (e.g., 'call mom', 'take out trash')."),
    name: z.string().optional().describe("Optional short name for the reminder (e.g., 'Daily calendar check', 'Book reflection')"),
  }),
  func: async ({ time_expression, query, name }, config) => {
    try {
      // Get Matrix room ID from config if available
      const matrixRoomId = (config as any)?.configurable?.matrixRoomId;

      if (!matrixRoomId) {
        return "❌ Cannot create reminder: This feature is only available in Matrix conversations. Please use the /scheduled page in the web interface to create reminders.";
      }

      // Parse the time expression
      const { cron, description } = parseTimeExpression(time_expression);

      // Validate cron expression and get next run time
      let nextRun: Date;
      try {
        const interval = CronExpressionParser.parse(cron);
        nextRun = interval.next().toDate();
      } catch (error) {
        return `❌ I couldn't parse the time expression "${time_expression}".

Error: ${error instanceof Error ? error.message : 'Unknown error'}

Please try rephrasing, for example:
- "tomorrow at 8am"
- "in 30 minutes"
- "every morning at 7am"
- "every Friday at 5pm"`;
      }

      // Generate a name if not provided
      const taskName = name || `${query.substring(0, 50)}${query.length > 50 ? '...' : ''}`;

      // Always create immediately - remove confirmation step to reduce LLM calls
      // The LLM can explain what it's doing in its response

      // Determine if this is a simple notification or a query
      // Simple notifications are action reminders like "take chicken out", "call mom"
      // Queries should use RAG to pull from knowledge base
      const lowerQuery = query.toLowerCase();

      // Check if query asks for information or references knowledge
      const asksForInfo = lowerQuery.match(/\b(what|how many|list|show|tell me|give me|find|search|remind me about|think about|remember)\b/);
      const referencesKnowledge = lowerQuery.match(/\b(books?|documents?|calendar|email|papers?|read|wrote|goodreads|files?)\b/);

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

      const formattedNextRun = nextRun.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      return `✅ **Reminder Created!**

• **Name:** ${taskName}
• **Schedule:** ${description}
• **Next run:** ${formattedNextRun}

I'll send you a message in this room when it's time. You can manage all your reminders at the /scheduled page in the web interface.`;
    } catch (error) {
      console.error("[ReminderTool] Error creating reminder:", error);
      return `❌ Failed to create reminder: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
});

/**
 * Tool to list scheduled reminders for the current conversation
 */
export const listRemindersTool = new DynamicStructuredTool({
  name: "list_reminders",
  description: "List all scheduled reminders for the current conversation. Use this when the user asks what reminders they have or wants to see their scheduled tasks.",
  schema: z.object({
    include_disabled: z.boolean().optional().describe("Whether to include disabled reminders (default: false)"),
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
        const nextRun = reminder.nextRun ? new Date(reminder.nextRun).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }) : "Not scheduled";

        response += `**${reminder.name}**\n`;
        response += `• ${status}\n`;
        response += `• Will ask: "${reminder.query}"\n`;
        response += `• Next: ${nextRun}\n`;

        if (reminder.lastRun) {
          const lastRun = new Date(reminder.lastRun).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
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
      return `❌ Failed to list reminders: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
});

/**
 * Tool to cancel/delete a scheduled reminder
 */
export const cancelReminderTool = new DynamicStructuredTool({
  name: "cancel_reminder",
  description: "Cancel or delete a scheduled reminder. Use this when the user wants to stop or remove a reminder.",
  schema: z.object({
    reminder_name: z.string().describe("The name of the reminder to cancel (must match exactly)"),
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
      return `❌ Failed to cancel reminder: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
});
