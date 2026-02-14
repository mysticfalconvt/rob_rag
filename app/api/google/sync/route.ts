import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { syncCalendarEvents, indexCalendarEvents, GoogleAuthError } from "@/lib/googleCalendar";

/**
 * POST: Sync and index calendar events
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    console.log("[GoogleSync] Starting calendar sync...");

    // Sync events from Google Calendar API
    const syncResult = await syncCalendarEvents();

    console.log("[GoogleSync] Sync complete, starting indexing...");

    // Index events (create embeddings) - only index new/changed events for efficiency
    const indexed = await indexCalendarEvents(true);

    return NextResponse.json({
      success: true,
      synced: syncResult,
      indexed,
      message: `Synced ${syncResult.created} new and ${syncResult.updated} updated events. Indexed ${indexed} events.`,
    });
  } catch (error) {
    console.error("[GoogleSync] Error syncing calendar:", error);

    // Handle authentication errors specifically
    if (error instanceof GoogleAuthError) {
      return NextResponse.json(
        {
          error: error.message,
          authError: true,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync calendar",
      },
      { status: 500 }
    );
  }
}
