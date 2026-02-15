import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { syncAllDataSources } from "@/lib/syncAll";

/**
 * POST /api/sync/all
 * Manually trigger sync for all data sources
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    console.log("[Sync All] Starting manual sync for all data sources...");

    const result = await syncAllDataSources();

    return NextResponse.json({
      success: true,
      message: "Sync completed",
      calendar: result.calendar,
      goodreads: result.goodreads,
      paperless: result.paperless,
    });
  } catch (error) {
    console.error("[Sync All] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
