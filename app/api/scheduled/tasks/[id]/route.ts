import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { CronExpressionParser } from "cron-parser";

/**
 * GET /api/scheduled/tasks/[id]
 * Get a single scheduled task
 */
export async function GET(
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

    const task = await prisma.scheduledTask.findUnique({
      where: { id },
      include: {
        executions: {
          take: 10,
          orderBy: { startedAt: "desc" },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Scheduled Tasks API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/scheduled/tasks/[id]
 * Update a scheduled task
 */
export async function PATCH(
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
    const body = await req.json();
    const { name, schedule, enabled, query, matrixRoomId, syncSource } = body;

    // Check if task exists
    const existingTask = await prisma.scheduledTask.findUnique({
      where: { id },
    });

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (enabled !== undefined) updateData.enabled = enabled;
    if (query !== undefined) updateData.query = query;
    if (matrixRoomId !== undefined) updateData.matrixRoomId = matrixRoomId;
    if (syncSource !== undefined) updateData.syncSource = syncSource;

    // If schedule is updated, validate and calculate nextRun
    if (schedule !== undefined) {
      try {
        const interval = CronExpressionParser.parse(schedule);
        updateData.schedule = schedule;
        updateData.nextRun = interval.next().toDate();
      } catch (error) {
        return NextResponse.json(
          {
            error: "Invalid cron expression",
            details: error instanceof Error ? error.message : "Unknown error",
          },
          { status: 400 },
        );
      }
    }

    const task = await prisma.scheduledTask.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Scheduled Tasks API] Error updating task:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/scheduled/tasks/[id]
 * Delete a scheduled task
 */
export async function DELETE(
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

    // Check if task exists
    const existingTask = await prisma.scheduledTask.findUnique({
      where: { id },
    });

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    await prisma.scheduledTask.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Scheduled Tasks API] Error deleting task:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
