import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

/**
 * One-time migration endpoint to fix custom OCR documents that have source="paperless"
 * This updates them to source="custom_ocr" so they show up in the correct filter
 */
export async function POST(req: NextRequest) {
  try {
    // Require authentication
    await requireAuth(req);

    // Find all files with custom OCR enabled but still marked as paperless
    const files = await prisma.indexedFile.findMany({
      where: {
        useCustomOcr: true,
        customOcrStatus: "completed",
        source: "paperless",
      },
    });

    let fileCount = 0;
    let chunkCount = 0;

    // Update each file and its chunks
    for (const file of files) {
      // Update the file
      await prisma.indexedFile.update({
        where: { id: file.id },
        data: { source: "custom_ocr" },
      });
      fileCount++;

      // Update all chunks for this file
      const chunkResult = await prisma.documentChunk.updateMany({
        where: { filePath: file.filePath },
        data: { source: "custom_ocr" },
      });
      chunkCount += chunkResult.count;
    }

    return NextResponse.json({
      message: `Successfully updated ${fileCount} files and ${chunkCount} chunks`,
      files: fileCount,
      chunks: chunkCount,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fixing custom OCR sources:", error);
    return NextResponse.json(
      {
        error: "Failed to fix sources",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
