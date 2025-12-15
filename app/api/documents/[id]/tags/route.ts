import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

// GET tags for a specific document
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req);
    const { id: fileId } = await params;

    const documentTags = await prisma.documentTag.findMany({
      where: { fileId },
      include: {
        tag: true,
      },
    });

    return NextResponse.json(
      documentTags.map((dt) => ({
        id: dt.tag.id,
        name: dt.tag.name,
        status: dt.tag.status,
        color: dt.tag.color,
      })),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching document tags:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST - Add tag to document
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req);
    const { id: fileId } = await params;
    const { tagId } = await req.json();

    if (!tagId) {
      return NextResponse.json(
        { error: "tagId is required" },
        { status: 400 },
      );
    }

    // Check if already exists
    const existing = await prisma.documentTag.findUnique({
      where: {
        fileId_tagId: { fileId, tagId },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Tag already added to document" },
        { status: 409 },
      );
    }

    const documentTag = await prisma.documentTag.create({
      data: {
        fileId,
        tagId,
      },
      include: {
        tag: true,
      },
    });

    return NextResponse.json(documentTag.tag, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error adding tag to document:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// DELETE - Remove tag from document
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req);
    const { id: fileId } = await params;
    const { searchParams } = new URL(req.url);
    const tagId = searchParams.get("tagId");

    if (!tagId) {
      return NextResponse.json(
        { error: "tagId is required" },
        { status: 400 },
      );
    }

    await prisma.documentTag.delete({
      where: {
        fileId_tagId: { fileId, tagId },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error removing tag from document:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
