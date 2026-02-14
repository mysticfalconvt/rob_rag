import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";

/**
 * GET /api/scheduled/executions
 * List execution history with optional filters
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
    const taskId = searchParams.get("taskId");
    const status = searchParams.get("status"); // "success" or "failed"
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: any = {};
    if (taskId) where.taskId = taskId;
    if (status) where.status = status;

    const [executions, total] = await Promise.all([
      prisma.taskExecution.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          task: {
            select: {
              id: true,
              type: true,
              name: true,
              matrixRoomId: true,
            },
          },
        },
      }),
      prisma.taskExecution.count({ where }),
    ]);

    return NextResponse.json({
      executions,
      total,
      limit,
      offset,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Scheduled Executions API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
