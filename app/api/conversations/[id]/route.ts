import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // Verify user owns this conversation or is admin
    if (
      conversation.userId !== session.user.id &&
      session.user.role !== "admin"
    ) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this conversation" },
        { status: 403 },
      );
    }

    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching conversation:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversation" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;

    // Check ownership before deleting
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    if (conversation.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this conversation" },
        { status: 403 },
      );
    }

    await prisma.conversation.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error deleting conversation:", error);
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    const { title } = await req.json();

    // Check ownership before updating
    const existing = await prisma.conversation.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    if (existing.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this conversation" },
        { status: 403 },
      );
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { title },
    });

    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error updating conversation:", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 },
    );
  }
}
