import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import prisma from "@/lib/prisma";

// GET /api/admin/activity - Get user activity statistics (admin only)
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    // Get all users with their activity counts
    const users = await prisma.authUser.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            conversations: true,
            uploadedFiles: true,
            sessions: true,
          },
        },
        conversations: {
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
          select: {
            updatedAt: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Transform the data to include last activity
    const userActivity = users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      conversationCount: user._count.conversations,
      uploadedFileCount: user._count.uploadedFiles,
      activeSessionCount: user._count.sessions,
      lastActivity: user.conversations[0]?.updatedAt || null,
    }));

    return NextResponse.json(userActivity);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Error fetching activity:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
