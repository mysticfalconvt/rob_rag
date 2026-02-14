import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";

/**
 * GET /api/scheduled/upcoming
 * Get next 24-48 hours of scheduled executions
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
    const hoursParam = searchParams.get("hours");
    const hours = hoursParam ? parseInt(hoursParam) : 48;

    const now = new Date();
    const endTime = new Date(now.getTime() + hours * 60 * 60 * 1000);

    const tasks = await prisma.scheduledTask.findMany({
      where: {
        enabled: true,
        nextRun: {
          gte: now,
          lte: endTime,
        },
      },
      orderBy: { nextRun: "asc" },
      include: {
        executions: {
          take: 1,
          orderBy: { startedAt: "desc" },
        },
      },
    });

    return NextResponse.json({ tasks, hours });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Scheduled Upcoming API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
