import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { matrixClient } from "@/lib/matrix/client";

/**
 * POST /api/matrix/sync
 * Sync rooms from Matrix to database
 */
export async function POST(req: NextRequest) {
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

    if (!matrixClient.isRunning()) {
      return NextResponse.json(
        { error: "Matrix client is not running" },
        { status: 400 },
      );
    }

    // First clean up any unreachable invites
    const cleanedCount = await matrixClient.cleanupUnreachableInvites();

    // Then sync all valid rooms
    await matrixClient.syncRoomsToDatabase();

    return NextResponse.json({
      success: true,
      message: `Rooms synced successfully${cleanedCount > 0 ? `. Cleaned up ${cleanedCount} unreachable invite(s)` : ""}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Matrix Sync API] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to sync rooms",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
