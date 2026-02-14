import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { matrixClient } from "@/lib/matrix/client";

/**
 * GET /api/matrix/rooms
 * List all Matrix rooms
 */
export async function GET(req: NextRequest) {
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

    // Get rooms from database
    const rooms = await prisma.matrixRoom.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Get room details from Matrix client if available
    const client = matrixClient.getClient();
    const roomsWithDetails = rooms.map((room) => {
      const matrixRoom = client?.getRoom(room.roomId);

      return {
        ...room,
        memberCount: matrixRoom?.getJoinedMemberCount() || 0,
        alias: matrixRoom?.getCanonicalAlias() || null,
        isJoined: !!matrixRoom,
      };
    });

    return NextResponse.json({ rooms: roomsWithDetails });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Matrix Rooms API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/matrix/rooms
 * Add or update a room
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
    const { roomId, name, description, enabled } = body;

    if (!roomId) {
      return NextResponse.json(
        { error: "Room ID is required" },
        { status: 400 },
      );
    }

    // Upsert room
    const room = await prisma.matrixRoom.upsert({
      where: { roomId },
      create: {
        roomId,
        name: name || "Unnamed Room",
        description: description || null,
        enabled: enabled !== undefined ? enabled : true,
      },
      update: {
        name: name || undefined,
        description: description !== undefined ? description : undefined,
        enabled: enabled !== undefined ? enabled : undefined,
      },
    });

    return NextResponse.json({ success: true, room });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Matrix Rooms API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/matrix/rooms
 * Update room settings
 */
export async function PATCH(req: NextRequest) {
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
    const { roomId, name, description, enabled } = body;

    if (!roomId) {
      return NextResponse.json(
        { error: "Room ID is required" },
        { status: 400 },
      );
    }

    // Update room
    const room = await prisma.matrixRoom.update({
      where: { roomId },
      data: {
        name: name || undefined,
        description: description !== undefined ? description : undefined,
        enabled: enabled !== undefined ? enabled : undefined,
      },
    });

    return NextResponse.json({ success: true, room });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Matrix Rooms API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/matrix/rooms
 * Remove a room from tracking
 */
export async function DELETE(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get("roomId");

    if (!roomId) {
      return NextResponse.json(
        { error: "Room ID is required" },
        { status: 400 },
      );
    }

    // Delete room
    await prisma.matrixRoom.delete({
      where: { roomId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Matrix Rooms API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
