import prisma from "./prisma";
import { claimDueTask, runScheduledTask } from "./scheduledTaskRunner";

/**
 * Background scheduler for periodic tasks
 * Runs in the Next.js server context
 */

/**
 * Scheduler state lives on globalThis, not on the class instance.
 *
 * Next.js compiles `instrumentation.ts` into a different bundle than the API
 * route handlers, so `import { backgroundScheduler }` can resolve to two
 * separate module instances in the same process — each with its own `isRunning`
 * flag. Both then started their own 60s interval and every due task fired twice.
 * `lib/init.ts` handles the same hazard the same way.
 */
interface SchedulerState {
  intervalId: NodeJS.Timeout | null;
  isRunning: boolean;
  matrixInitTriggered: boolean;
}

const globalScheduler = globalThis as typeof globalThis & {
  __robrag_scheduler?: SchedulerState;
};

globalScheduler.__robrag_scheduler ??= {
  intervalId: null,
  isRunning: false,
  matrixInitTriggered: false,
};

const state = globalScheduler.__robrag_scheduler;

class BackgroundScheduler {
  private checkIntervalMs = 60000; // Check every minute

  start() {
    if (state.isRunning) {
      console.log("[Scheduler] Already running");
      return;
    }

    // Background scheduler started
    state.isRunning = true;

    // Initialize Matrix client after a delay to avoid module loading issues
    if (!state.matrixInitTriggered) {
      state.matrixInitTriggered = true;
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
    state.intervalId = setInterval(() => {
      this.checkScheduledTasks();
    }, this.checkIntervalMs);
  }

  stop() {
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    state.isRunning = false;
    console.log("[Scheduler] Stopped background scheduler");
  }

  private async checkScheduledTasks() {
    try {
      // Check if daily sync is due
      await this.checkDailySync();

      // Check for due ScheduledTask records (Matrix reminders only)
      await this.executeScheduledTasks();
    } catch (error) {
      console.error("[Scheduler] Error running scheduled tasks:", error);
    }
  }

  /**
   * Check if daily sync is due and execute it
   */
  private async checkDailySync() {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
        select: {
          dailySyncTime: true,
          dailySyncLastRun: true,
        },
      });

      if (!settings?.dailySyncTime) {
        return; // No sync time configured
      }

      const now = new Date();
      const [hours, minutes] = settings.dailySyncTime.split(":").map(Number);

      // Create a date for today at the specified time
      const scheduledTime = new Date(now);
      scheduledTime.setHours(hours, minutes, 0, 0);

      // If scheduled time hasn't passed today yet, skip
      if (now < scheduledTime) {
        return;
      }

      // Check if we already ran today
      if (settings.dailySyncLastRun) {
        const lastRun = new Date(settings.dailySyncLastRun);
        const lastRunDay = lastRun.toDateString();
        const todayDay = now.toDateString();

        // If last run was today, skip
        if (lastRunDay === todayDay) {
          return;
        }
      }

      // Claim the run before starting it, by compare-and-swapping the
      // `dailySyncLastRun` value we just read. `syncAllDataSources` only stamps
      // that field when it *finishes*, so without this a sync that outlasts the
      // check interval gets started again on every tick.
      const claimed = await prisma.settings.updateMany({
        where: {
          id: "singleton",
          dailySyncLastRun: settings.dailySyncLastRun,
        },
        data: { dailySyncLastRun: now },
      });

      if (claimed.count !== 1) {
        return; // Someone else already claimed today's sync
      }

      // Time to run the daily sync!
      console.log("[Scheduler] Running daily data sync...");
      const { syncAllDataSources } = await import("./syncAll");
      await syncAllDataSources();
    } catch (error) {
      console.error("[Scheduler] Error checking daily sync:", error);
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
          // Claim before executing: this advances `nextRun` atomically, so a
          // concurrent loop — or a later tick while this run is still in flight
          // — can't send the same reminder a second time.
          const claimed = await claimDueTask(task);
          if (!claimed) {
            console.log(
              `[Scheduler] Task ${task.name} already claimed elsewhere, skipping`,
            );
            continue;
          }

          await runScheduledTask(task, { trigger: "scheduled" });
        } catch (error) {
          console.error(`[Scheduler] Error executing task ${task.id}:`, error);
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error checking scheduled tasks:", error);
    }
  }

  getStatus() {
    return {
      isRunning: state.isRunning,
      checkIntervalMs: this.checkIntervalMs,
    };
  }
}

// Singleton instance
export const backgroundScheduler = new BackgroundScheduler();

// Auto-start in production (but not during build)
if (typeof window === "undefined" && process.env.NODE_ENV === "production") {
  // Delay start to ensure database is ready
  setTimeout(() => {
    backgroundScheduler.start();
  }, 5000);
}
