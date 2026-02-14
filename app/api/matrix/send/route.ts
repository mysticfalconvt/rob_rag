import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { sendFormattedMessage } from "@/lib/matrix/sender";

/**
 * POST /api/matrix/send
 * Send a message to a Matrix room (for testing/admin use)
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

    const body = await req.json();
    const { roomId, message } = body;

    if (!roomId || !message) {
      return NextResponse.json(
        { error: "Room ID and message are required" },
        { status: 400 },
      );
    }

    // Send message
    await sendFormattedMessage(roomId, message);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Matrix Send API] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to send message",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
