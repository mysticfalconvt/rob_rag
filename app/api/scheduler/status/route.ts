import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { backgroundScheduler } from "@/lib/scheduler";

/**
 * GET: Get scheduler status
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const status = backgroundScheduler.getStatus();

    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error) {
    console.error("[Scheduler Status] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get scheduler status",
      },
      { status: 500 }
    );
  }
}

/**
 * POST: Manually start/stop the scheduler
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json();
    const { action } = body;

    if (action === "start") {
      backgroundScheduler.start();
    } else if (action === "stop") {
      backgroundScheduler.stop();
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'start' or 'stop'" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      status: backgroundScheduler.getStatus(),
    });
  } catch (error) {
    console.error("[Scheduler Control] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to control scheduler",
      },
      { status: 500 }
    );
  }
}
