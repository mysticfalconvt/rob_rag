import type { ScheduledTask, TaskExecution } from "@prisma/client";
import { CronExpressionParser } from "cron-parser";
import { config as appConfig } from "./config";
import { sendFormattedMessage } from "./matrix/sender";
import prisma from "./prisma";

/**
 * Single implementation of "execute a ScheduledTask".
 *
 * Both callers share this: the background scheduler (`lib/scheduler.ts`) and the
 * manual "Run Now" button (`/api/scheduled/tasks/[id]/run`). They used to have
 * two divergent copies — the scheduler calling `runAgent` in-process while the
 * route POSTed to `/api/chat` without a session cookie (an unavoidable 401) —
 * which is why "Run Now" never worked and simple reminders behaved differently
 * depending on how they were triggered.
 */

export type TaskTrigger = "scheduled" | "manual";

export interface RunTaskResult {
  status: "success" | "failed";
  error: string | null;
  response: string | null;
  duration: number;
  execution: TaskExecution;
}

/**
 * Next fire time for a cron expression, plus whether it looks like a one-time
 * task (specific day-of-month AND month, e.g. "0 9 25 7 *").
 */
export function computeSchedule(schedule: string): {
  nextRun: Date | null;
  isOneTime: boolean;
} {
  let nextRun: Date | null = null;
  let isOneTime = false;

  try {
    const interval = CronExpressionParser.parse(schedule, {
      tz: appConfig.USER_TIMEZONE,
    });
    nextRun = interval.next().toDate();

    const cronParts = schedule.trim().split(/\s+/);
    if (cronParts.length >= 5) {
      const dayOfMonth = cronParts[2];
      const month = cronParts[3];
      isOneTime = /^\d+$/.test(dayOfMonth) && /^\d+$/.test(month);
    }
  } catch (err) {
    console.error(
      `[TaskRunner] Failed to parse cron expression "${schedule}":`,
      err,
    );
  }

  return { nextRun, isOneTime };
}

/**
 * Atomically claim a due task before executing it.
 *
 * The update is a compare-and-swap on the `nextRun` value we read: it only
 * matches while the row still says the task is due at that exact time, so if two
 * scheduler loops (duplicate module instances, or two app replicas) see the same
 * due task, exactly one claim succeeds and the other returns false. Advancing
 * `nextRun` up front also means a task that takes longer than the check interval
 * can't be picked up again mid-flight.
 *
 * Returns false when another worker already claimed it.
 */
export async function claimDueTask(task: ScheduledTask): Promise<boolean> {
  const { nextRun, isOneTime } = computeSchedule(task.schedule);

  const claimed = await prisma.scheduledTask.updateMany({
    where: {
      id: task.id,
      enabled: true,
      nextRun: task.nextRun,
    },
    data: {
      nextRun,
      // One-time tasks are retired as part of the claim so a failed run can't
      // leave them armed for a second attempt.
      enabled: !isOneTime,
    },
  });

  return claimed.count === 1;
}

/**
 * Execute a task, record a TaskExecution row, and update the task's last-run
 * fields. Never throws for task-level failures — they come back as
 * `status: "failed"` with `error` set, and are recorded either way.
 *
 * Scheduling (`nextRun` / `enabled`) is deliberately NOT touched here: the
 * scheduler advances it in `claimDueTask`, and a manual run must not shift the
 * next scheduled fire time.
 */
export async function runScheduledTask(
  task: ScheduledTask,
  { trigger }: { trigger: TaskTrigger },
): Promise<RunTaskResult> {
  const startedAt = new Date();
  let status: "success" | "failed" = "success";
  let error: string | null = null;
  let response: string | null = null;
  let metadata: Record<string, unknown> = {};

  console.log(
    `[TaskRunner] Executing task: ${task.name} (${task.type}, ${trigger})`,
  );

  try {
    let outcome: TaskOutcome;
    if (task.type === "matrix_reminder") {
      outcome = await runMatrixReminder(task);
    } else if (task.type === "auto_sync") {
      outcome = await runAutoSync(task);
    } else {
      throw new Error(`Unknown task type: ${task.type}`);
    }
    response = outcome.response;
    metadata = outcome.metadata;

    console.log(`[TaskRunner] Task ${task.name} completed successfully`);
  } catch (err) {
    console.error(`[TaskRunner] Task ${task.name} failed:`, err);
    status = "failed";
    error = err instanceof Error ? err.message : "Unknown error";
  }

  const completedAt = new Date();
  const duration = completedAt.getTime() - startedAt.getTime();

  const execution = await prisma.taskExecution.create({
    data: {
      taskId: task.id,
      status,
      startedAt,
      completedAt,
      duration,
      error,
      response,
      metadata: JSON.stringify({ ...metadata, trigger }),
    },
  });

  await prisma.scheduledTask.update({
    where: { id: task.id },
    data: {
      lastRun: startedAt,
      lastRunStatus: status,
      lastRunError: error,
    },
  });

  return { status, error, response, duration, execution };
}

const SIMPLE_REMINDER_PREFIX = "SIMPLE_REMINDER:";

interface TaskOutcome {
  response: string;
  metadata: Record<string, unknown>;
}

async function runMatrixReminder(task: ScheduledTask): Promise<TaskOutcome> {
  if (!task.query || !task.matrixRoomId) {
    throw new Error("Missing query or matrixRoomId for reminder");
  }

  // A simple reminder is plain notification text, not something to ask the agent.
  if (task.query.startsWith(SIMPLE_REMINDER_PREFIX)) {
    const reminderText = task.query.slice(SIMPLE_REMINDER_PREFIX.length).trim();
    const message = `🔔 **Reminder**\n\n${reminderText}`;

    await sendFormattedMessage(task.matrixRoomId, message);

    return {
      response: message,
      metadata: {
        roomId: task.matrixRoomId,
        type: "simple_notification",
        reminderText,
      },
    };
  }

  // Query reminder — run the unified agent in-process (no HTTP self-call, so no
  // session cookie is needed).
  const { runAgent } = await import("./agent/runAgent");
  const { resolveScheduledIdentity } = await import("./agent/identity");

  const { userId, userProfile } = await resolveScheduledIdentity();
  const result = await runAgent({
    messages: [{ role: "user", content: task.query }],
    channel: "scheduled",
    userId,
    userProfile,
    matrixRoomId: task.matrixRoomId,
  });

  const text = result.text.trim();

  await sendFormattedMessage(task.matrixRoomId, text, result.sources);

  return {
    response: text,
    metadata: {
      roomId: task.matrixRoomId,
      query: task.query,
      type: "query_reminder",
      sourceCount: result.sources.length,
    },
  };
}

async function runAutoSync(task: ScheduledTask): Promise<TaskOutcome> {
  if (!task.syncSource) {
    throw new Error("Missing syncSource for auto-sync task");
  }

  let syncResult: Record<string, unknown>;

  if (task.syncSource === "paperless") {
    const { runScheduledSync } = await import("./paperlessSync");
    await runScheduledSync();
    syncResult = { status: "success", message: "Paperless sync completed" };
  } else if (task.syncSource === "google-calendar") {
    throw new Error("Google Calendar auto-sync not yet implemented");
  } else if (task.syncSource === "goodreads") {
    throw new Error("Goodreads auto-sync not yet implemented");
  } else {
    throw new Error(`Unknown sync source: ${task.syncSource}`);
  }

  return {
    response: `Sync completed: ${JSON.stringify(syncResult)}`,
    metadata: syncResult,
  };
}
