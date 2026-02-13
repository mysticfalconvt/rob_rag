import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { ocrQueue } from "@/lib/ocrQueue";

/**
 * GET: Get OCR queue status
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const status = ocrQueue.getStatus();

    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error) {
    console.error("[OCR Queue Status] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get queue status",
      },
      { status: 500 }
    );
  }
}

/**
 * POST: Set max concurrent jobs
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json();
    const { maxConcurrent } = body;

    if (typeof maxConcurrent !== 'number' || maxConcurrent < 1 || maxConcurrent > 10) {
      return NextResponse.json(
        { error: "maxConcurrent must be a number between 1 and 10" },
        { status: 400 }
      );
    }

    ocrQueue.setMaxConcurrent(maxConcurrent);

    return NextResponse.json({
      success: true,
      status: ocrQueue.getStatus(),
    });
  } catch (error) {
    console.error("[OCR Queue Control] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to control queue",
      },
      { status: 500 }
    );
  }
}
