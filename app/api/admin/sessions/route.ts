import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import prisma from "@/lib/prisma";
import { getClientIp } from "@/lib/rateLimit";

// GET /api/admin/sessions - List all active sessions (admin only)
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const sessions = await prisma.session.findMany({
      where: {
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
      orderBy: {
        lastActive: "desc",
      },
    });

    return NextResponse.json(sessions);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/sessions - Delete all sessions for a user or a specific session
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const userId = searchParams.get("userId");

    if (sessionId) {
      // Delete specific session
      await prisma.session.delete({
        where: { id: sessionId },
      });
      return NextResponse.json({ success: true, message: "Session deleted" });
    } else if (userId) {
      // Delete all sessions for a user
      const result = await prisma.session.deleteMany({
        where: { userId },
      });
      return NextResponse.json({
        success: true,
        message: `Deleted ${result.count} sessions`,
        count: result.count,
      });
    } else {
      return NextResponse.json(
        { error: "sessionId or userId required" },
        { status: 400 },
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Error deleting session:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
