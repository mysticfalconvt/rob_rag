import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { disconnectGoogleCalendar } from "@/lib/googleCalendar";

/**
 * Disconnect Google Calendar (clear credentials)
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    await disconnectGoogleCalendar();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[GoogleAuth] Error disconnecting:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to disconnect",
      },
      { status: 500 }
    );
  }
}
