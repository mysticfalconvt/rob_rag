import { runScheduledSync } from "./paperlessSync";
import prisma from "./prisma";
import { CronExpressionParser } from "cron-parser";
import { sendFormattedMessage } from "./matrix/sender";

/**
 * Background scheduler for periodic tasks
 * Runs in the Next.js server context
 */
class BackgroundScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs = 60000; // Check every minute
  private matrixInitTriggered = false;

  start() {
    if (this.isRunning) {
      console.log("[Scheduler] Already running");
      return;
    }

    console.log("[Scheduler] Starting background scheduler");
    this.isRunning = true;

    // Initialize Matrix client after a delay to avoid module loading issues
    if (!this.matrixInitTriggered) {
      this.matrixInitTriggered = true;
      setTimeout(async () => {
        try {
          const { initializeMatrix } = await import("./init");
          initializeMatrix();
        } catch (error) {
          console.error("[Scheduler] Failed to initialize Matrix:", error);
        }
      }, 10000); // 10 second delay to ensure app is fully started
    }

    // Run immediately on start
    this.checkScheduledTasks();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.checkScheduledTasks();
    }, this.checkIntervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("[Scheduler] Stopped background scheduler");
  }

  private async checkScheduledTasks() {
    try {
      // Check if Paperless sync is due (legacy)
      await runScheduledSync();

      // Check for due ScheduledTask records
      await this.executeScheduledTasks();
    } catch (error) {
      console.error("[Scheduler] Error running scheduled tasks:", error);
    }
  }

  /**
   * Execute any ScheduledTask records that are due
   */
  private async executeScheduledTasks() {
    try {
      const now = new Date();

      // Find all enabled tasks where nextRun <= now
      const dueTasks = await prisma.scheduledTask.findMany({
        where: {
          enabled: true,
          nextRun: {
            lte: now,
          },
        },
      });

      if (dueTasks.length === 0) {
        return;
      }

      console.log(`[Scheduler] Found ${dueTasks.length} due tasks`);

      // Execute each task
      for (const task of dueTasks) {
        try {
          await this.executeTask(task);
        } catch (error) {
          console.error(`[Scheduler] Error executing task ${task.id}:`, error);
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error checking scheduled tasks:", error);
    }
  }

  /**
   * Execute a single scheduled task
   */
  private async executeTask(task: any) {
    const startedAt = new Date();
    let status = "success";
    let error: string | null = null;
    let response: string | null = null;
    let metadata: any = {};

    console.log(`[Scheduler] Executing task: ${task.name} (${task.type})`);

    try {
      if (task.type === "matrix_reminder") {
        // Execute Matrix reminder
        if (!task.query || !task.matrixRoomId) {
          throw new Error("Missing query or matrixRoomId for reminder");
        }

        // Check if this is a simple reminder (notification) or a query
        const isSimpleReminder = task.query.startsWith("SIMPLE_REMINDER:");

        if (isSimpleReminder) {
          // Simple notification - just send the reminder text directly
          const reminderText = task.query.replace("SIMPLE_REMINDER:", "").trim();
          const message = `🔔 **Reminder**\n\n${reminderText}`;

          await sendFormattedMessage(task.matrixRoomId, message);

          response = message;
          metadata = {
            roomId: task.matrixRoomId,
            type: "simple_notification",
            reminderText,
          };
        } else {
          // Query reminder - call RAG flow
          const internalServiceKey = process.env.INTERNAL_SERVICE_KEY;
          if (!internalServiceKey) {
            throw new Error("INTERNAL_SERVICE_KEY not configured");
          }

          const ragResponse = await fetch("http://localhost:3000/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: task.query }],
              triggerSource: "scheduled",
              internalServiceKey,
            }),
          });

          if (!ragResponse.ok) {
            throw new Error(`RAG flow returned ${ragResponse.status}`);
          }

          // Read streaming response
          const reader = ragResponse.body?.getReader();
          if (!reader) {
            throw new Error("No response body");
          }

          let fullResponse = "";
          let sources: any[] = [];
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });

            if (chunk.includes("__SOURCES__:")) {
              const parts = chunk.split("__SOURCES__:");
              fullResponse += parts[0];

              if (parts[1]) {
                try {
                  const sourcesData = JSON.parse(parts[1]);
                  sources = sourcesData.sources || [];
                } catch (e) {
                  console.error("[Scheduler] Failed to parse sources:", e);
                }
              }
            } else {
              fullResponse += chunk;
            }
          }

          response = fullResponse.trim();

          // Send to Matrix room
          await sendFormattedMessage(task.matrixRoomId, response, sources);

          metadata = {
            roomId: task.matrixRoomId,
            query: task.query,
            type: "query_reminder",
            sourceCount: sources.length,
          };
        }
      } else if (task.type === "auto_sync") {
        // Execute auto-sync
        if (!task.syncSource) {
          throw new Error("Missing syncSource for auto-sync task");
        }

        let syncResult: any = {};

        if (task.syncSource === "google-calendar") {
          // TODO: Implement Google Calendar sync
          throw new Error("Google Calendar auto-sync not yet implemented");
        } else if (task.syncSource === "paperless") {
          // Use existing paperless sync
          await runScheduledSync();
          syncResult = { status: "success", message: "Paperless sync completed" };
        } else if (task.syncSource === "goodreads") {
          // TODO: Implement Goodreads sync
          throw new Error("Goodreads auto-sync not yet implemented");
        } else {
          throw new Error(`Unknown sync source: ${task.syncSource}`);
        }

        response = `Sync completed: ${JSON.stringify(syncResult)}`;
        metadata = syncResult;
      } else {
        throw new Error(`Unknown task type: ${task.type}`);
      }

      console.log(`[Scheduler] Task ${task.name} completed successfully`);
    } catch (err) {
      console.error(`[Scheduler] Task ${task.name} failed:`, err);
      status = "failed";
      error = err instanceof Error ? err.message : "Unknown error";
    }

    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    // Create execution record
    await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        status,
        startedAt,
        completedAt,
        duration,
        error,
        response,
        metadata: JSON.stringify(metadata),
      },
    });

    // Calculate next run time and check if this is a one-time task
    let nextRun: Date | null = null;
    let isOneTimeTask = false;

    try {
      const interval = CronExpressionParser.parse(task.schedule);
      nextRun = interval.next().toDate();

      // Check if this is a one-time cron (has specific date fields like day and month)
      // One-time crons have specific day and month values (not * or */n)
      const cronParts = task.schedule.trim().split(/\s+/);
      if (cronParts.length >= 5) {
        const dayOfMonth = cronParts[2];
        const month = cronParts[3];
        // If both day and month are specific numbers (not wildcards), it's likely one-time
        isOneTimeTask = /^\d+$/.test(dayOfMonth) && /^\d+$/.test(month);
      }
    } catch (err) {
      console.error(`[Scheduler] Failed to calculate nextRun for task ${task.id}:`, err);
    }

    // Update task last run info
    // Disable one-time tasks after execution
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: {
        lastRun: startedAt,
        lastRunStatus: status,
        lastRunError: error,
        nextRun,
        enabled: isOneTimeTask ? false : task.enabled, // Disable one-time tasks
      },
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.checkIntervalMs,
    };
  }
}

// Singleton instance
export const backgroundScheduler = new BackgroundScheduler();

// Auto-start in production (but not during build)
if (typeof window === 'undefined' && process.env.NODE_ENV === 'production') {
  // Delay start to ensure database is ready
  setTimeout(() => {
    backgroundScheduler.start();
  }, 5000);
}
