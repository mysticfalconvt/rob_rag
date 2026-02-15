import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { CronExpressionParser } from "cron-parser";

/**
 * GET /api/scheduled/tasks
 * List all scheduled tasks with optional filters
 */
export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type"); // "matrix_reminder" or "auto_sync"
    const enabled = searchParams.get("enabled"); // "true" or "false"

    const where: any = {};
    if (type) where.type = type;
    if (enabled !== null) where.enabled = enabled === "true";

    const tasks = await prisma.scheduledTask.findMany({
      where,
      orderBy: [{ enabled: "desc" }, { nextRun: "asc" }],
      include: {
        executions: {
          take: 1,
          orderBy: { startedAt: "desc" },
        },
      },
    });

    return NextResponse.json({ tasks });
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
 * POST /api/scheduled/tasks
 * Create a new scheduled task
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const {
      type,
      name,
      schedule,
      enabled = true,
      query,
      matrixRoomId,
      syncSource,
    } = body;

    // Validate required fields
    if (!type || !name || !schedule) {
      return NextResponse.json(
        { error: "Missing required fields: type, name, schedule" },
        { status: 400 },
      );
    }

    // Validate type
    if (type !== "matrix_reminder") {
      return NextResponse.json(
        { error: "Invalid type. Must be 'matrix_reminder'" },
        { status: 400 },
      );
    }

    // Validate required fields for matrix reminders
    if (!query || !matrixRoomId) {
      return NextResponse.json(
        {
          error: "Matrix reminders require 'query' and 'matrixRoomId' fields",
        },
        { status: 400 },
      );
    }

    // Validate cron expression
    let nextRun: Date;
    try {
      const interval = CronExpressionParser.parse(schedule);
      nextRun = interval.next().toDate();
    } catch (error) {
      return NextResponse.json(
        {
          error: "Invalid cron expression",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 400 },
      );
    }

    // Create task
    const task = await prisma.scheduledTask.create({
      data: {
        type,
        name,
        schedule,
        enabled,
        query,
        matrixRoomId,
        nextRun,
      },
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Scheduled Tasks API] Error creating task:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
