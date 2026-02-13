import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { syncPaperlessDocuments, getPaperlessSyncSettings } from "@/lib/paperlessSync";

/**
 * POST: Manually trigger Paperless sync
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    console.log("[PaperlessSync API] Starting manual sync...");

    // Get sync settings
    const settings = await getPaperlessSyncSettings();
    if (!settings) {
      return NextResponse.json(
        { error: "Paperless sync settings not configured" },
        { status: 400 }
      );
    }

    // Run sync with configured filters and auto-OCR
    const result = await syncPaperlessDocuments(
      settings.filters || undefined,
      settings.autoOcr,
      settings.visionModel || undefined
    );

    const message = [
      `Synced ${result.newDocuments} new and ${result.updatedDocuments} updated documents.`,
      result.skippedDocuments > 0 ? `Skipped ${result.skippedDocuments} documents.` : null,
      result.ocrJobsStarted > 0 ? `Started ${result.ocrJobsStarted} OCR jobs.` : null,
      result.errors.length > 0 ? `${result.errors.length} errors occurred.` : null,
    ].filter(Boolean).join(" ");

    return NextResponse.json({
      success: true,
      result,
      message,
    });
  } catch (error) {
    console.error("[PaperlessSync API] Error syncing:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync Paperless documents",
      },
      { status: 500 }
    );
  }
}

/**
 * GET: Get sync status and last run info
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const settings = await getPaperlessSyncSettings();
    if (!settings) {
      return NextResponse.json(
        { error: "Paperless sync settings not configured" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      enabled: settings.enabled,
      interval: settings.interval,
      lastRun: settings.lastRun,
      autoOcr: settings.autoOcr,
      filters: settings.filters,
    });
  } catch (error) {
    console.error("[PaperlessSync API] Error getting status:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get sync status",
      },
      { status: 500 }
    );
  }
}
