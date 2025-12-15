import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

/**
 * POST - Merge this tag into another tag
 * All documents tagged with this tag will be retagged with the target tag
 * This tag will then be deleted
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req);
    const { id: sourceTagId } = await params;
    const { targetTagId } = await req.json();

    if (!targetTagId) {
      return NextResponse.json(
        { error: "targetTagId is required" },
        { status: 400 },
      );
    }

    if (sourceTagId === targetTagId) {
      return NextResponse.json(
        { error: "Cannot merge tag into itself" },
        { status: 400 },
      );
    }

    // Verify both tags exist
    const sourceTag = await prisma.tag.findUnique({
      where: { id: sourceTagId },
    });
    const targetTag = await prisma.tag.findUnique({
      where: { id: targetTagId },
    });

    if (!sourceTag) {
      return NextResponse.json(
        { error: "Source tag not found" },
        { status: 404 },
      );
    }
    if (!targetTag) {
      return NextResponse.json(
        { error: "Target tag not found" },
        { status: 404 },
      );
    }

    // Get all documents tagged with source tag
    const sourceDocumentTags = await prisma.documentTag.findMany({
      where: { tagId: sourceTagId },
    });

    // For each document, update or create target tag association
    for (const docTag of sourceDocumentTags) {
      await prisma.documentTag.upsert({
        where: {
          fileId_tagId: {
            fileId: docTag.fileId,
            tagId: targetTagId,
          },
        },
        update: {}, // Already exists, do nothing
        create: {
          fileId: docTag.fileId,
          tagId: targetTagId,
        },
      });
    }

    // Delete all source tag associations
    await prisma.documentTag.deleteMany({
      where: { tagId: sourceTagId },
    });

    // Delete source tag
    await prisma.tag.delete({
      where: { id: sourceTagId },
    });

    return NextResponse.json({
      success: true,
      message: `Merged "${sourceTag.name}" into "${targetTag.name}"`,
      documentsUpdated: sourceDocumentTags.length,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error merging tags:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
