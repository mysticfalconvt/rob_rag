import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { validateConnection } from "@/lib/googleCalendar";
import prisma from "@/lib/prisma";

/**
 * GET: Google Calendar configuration status
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: {
        googleClientId: true,
        googleClientSecret: true,
        googleAccessToken: true,
        googleRefreshToken: true,
        googleCalendarIds: true,
        googleLastSynced: true,
        googleSyncEnabled: true,
      },
    });

    const configured = !!(settings?.googleClientId && settings?.googleClientSecret);
    const calendarIds = settings?.googleCalendarIds
      ? JSON.parse(settings.googleCalendarIds)
      : [];

    // Validate the connection if we have tokens
    let authenticated = false;
    let connectionValid = false;
    let connectionError = null;

    if (settings?.googleAccessToken) {
      const validation = await validateConnection();
      connectionValid = validation.valid;
      authenticated = validation.valid; // Only consider authenticated if validation passes
      connectionError = validation.error || null;

      if (!validation.valid) {
        console.log(`[GoogleStatus] Connection validation failed: ${validation.error}`);
      }
    }

    return NextResponse.json({
      configured,
      authenticated,
      connectionValid,
      connectionError,
      calendarIds,
      lastSynced: settings?.googleLastSynced?.toISOString() || null,
      syncEnabled: settings?.googleSyncEnabled || false,
    });
  } catch (error) {
    console.error("[GoogleStatus] Error fetching status:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch status",
      },
      { status: 500 }
    );
  }
}
