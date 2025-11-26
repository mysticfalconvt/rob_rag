import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    // Only return conversations for the current user
    const conversations = await prisma.conversation.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    return NextResponse.json(conversations);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching conversations:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const { title } = await req.json();

    const conversation = await prisma.conversation.create({
      data: {
        title: title || "New Conversation",
        userId: session.user.id,
      },
    });

    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error creating conversation:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 },
    );
  }
}
