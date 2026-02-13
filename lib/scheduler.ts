import { runScheduledSync } from "./paperlessSync";

/**
 * Background scheduler for periodic tasks
 * Runs in the Next.js server context
 */
class BackgroundScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs = 60000; // Check every minute

  start() {
    if (this.isRunning) {
      console.log("[Scheduler] Already running");
      return;
    }

    console.log("[Scheduler] Starting background scheduler");
    this.isRunning = true;

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
      // Check if Paperless sync is due
      await runScheduledSync();
    } catch (error) {
      console.error("[Scheduler] Error running scheduled tasks:", error);
    }
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
