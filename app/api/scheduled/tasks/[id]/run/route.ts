import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { runScheduledTask } from "@/lib/scheduledTaskRunner";
import { requireAuth } from "@/lib/session";

export const maxDuration = 300;

/**
 * POST /api/scheduled/tasks/[id]/run
 * Trigger immediate execution of a scheduled task.
 *
 * Execution goes through the same `runScheduledTask` the background scheduler
 * uses. It used to POST to `/api/chat` over localhost instead, which always
 * failed with 401 because that endpoint requires a session cookie the
 * server-to-server call never carried.
 *
 * A manual run does not touch `nextRun`/`enabled` — the regular schedule is
 * unaffected.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(req);

    // Require admin role
    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Get task
    const task = await prisma.scheduledTask.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const { execution, status, response, error, duration } =
      await runScheduledTask(task, { trigger: "manual" });

    return NextResponse.json({
      execution,
      status,
      response,
      error,
      duration,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Scheduled Tasks API] Error running task:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
