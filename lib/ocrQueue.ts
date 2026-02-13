/**
 * OCR Job Queue - Process OCR jobs with concurrency control
 * Prevents overwhelming the LLM server with too many simultaneous requests
 */

import prisma from "./prisma";
import { processOcrJobAsync } from "./visionOcr";

interface QueuedJob {
  jobId: string;
  paperlessId: number;
  visionModel: string;
}

class OcrQueue {
  private queue: QueuedJob[] = [];
  private processing = false;
  private maxConcurrent = 1; // Process 1 at a time by default
  private currentlyProcessing = 0;

  /**
   * Add a job to the queue
   */
  enqueue(jobId: string, paperlessId: number, visionModel: string) {
    this.queue.push({ jobId, paperlessId, visionModel });
    console.log(`[OcrQueue] Enqueued job ${jobId} for document ${paperlessId}. Queue size: ${this.queue.length}`);

    // Start processing if not already running
    if (!this.processing) {
      this.startProcessing();
    }
  }

  /**
   * Start processing the queue
   */
  private async startProcessing() {
    if (this.processing) return;

    this.processing = true;
    console.log(`[OcrQueue] Started processing queue with max concurrency: ${this.maxConcurrent}`);

    while (this.queue.length > 0 || this.currentlyProcessing > 0) {
      // Start new jobs up to max concurrency
      while (this.queue.length > 0 && this.currentlyProcessing < this.maxConcurrent) {
        const job = this.queue.shift();
        if (!job) break;

        this.currentlyProcessing++;
        console.log(`[OcrQueue] Processing job ${job.jobId} (${this.currentlyProcessing}/${this.maxConcurrent} slots, ${this.queue.length} queued)`);

        // Process job without blocking
        this.processJob(job).finally(() => {
          this.currentlyProcessing--;
        });
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing = false;
    console.log(`[OcrQueue] Queue processing complete`);
  }

  /**
   * Process a single job
   */
  private async processJob(job: QueuedJob) {
    try {
      console.log(`[OcrQueue] Starting OCR for document ${job.paperlessId}`);
      await processOcrJobAsync(job.jobId, job.paperlessId, job.visionModel);
      console.log(`[OcrQueue] ✅ Completed OCR for document ${job.paperlessId}`);
    } catch (error: any) {
      console.error(`[OcrQueue] ❌ Failed OCR for document ${job.paperlessId}:`, error.message);

      // Mark job as failed in database
      try {
        await prisma.ocrJob.update({
          where: { id: job.jobId },
          data: {
            status: "failed",
            error: error.message,
            completedAt: new Date(),
          },
        });
      } catch (dbError) {
        console.error(`[OcrQueue] Failed to update job status:`, dbError);
      }
    }
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      queueSize: this.queue.length,
      processing: this.processing,
      currentlyProcessing: this.currentlyProcessing,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Set max concurrent jobs
   */
  setMaxConcurrent(max: number) {
    this.maxConcurrent = Math.max(1, max);
    console.log(`[OcrQueue] Max concurrency set to ${this.maxConcurrent}`);
  }
}

// Singleton instance
export const ocrQueue = new OcrQueue();
