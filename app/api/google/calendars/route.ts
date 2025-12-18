import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { listCalendars } from "@/lib/googleCalendar";
import prisma from "@/lib/prisma";

/**
 * GET: List available calendars
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const calendars = await listCalendars();

    return NextResponse.json({ calendars });
  } catch (error) {
    console.error("[GoogleCalendars] Error listing calendars:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list calendars",
      },
      { status: 500 }
    );
  }
}

/**
 * POST: Save selected calendar IDs
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const { calendarIds } = await req.json();

    if (!Array.isArray(calendarIds)) {
      return NextResponse.json(
        { error: "calendarIds must be an array" },
        { status: 400 }
      );
    }

    // Save selected calendar IDs to settings
    await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        googleCalendarIds: JSON.stringify(calendarIds),
      },
    });

    return NextResponse.json({ success: true, count: calendarIds.length });
  } catch (error) {
    console.error("[GoogleCalendars] Error saving calendar selection:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save calendar selection",
      },
      { status: 500 }
    );
  }
}
