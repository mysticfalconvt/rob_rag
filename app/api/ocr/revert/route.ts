import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/session";
import fs from "node:fs/promises";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { paperlessId } = await req.json();

    if (!paperlessId) {
      return NextResponse.json(
        { error: "paperlessId is required" },
        { status: 400 },
      );
    }

    const filePath = `paperless://${paperlessId}`;

    // Get the file record
    const fileRecord = await prisma.indexedFile.findUnique({
      where: { filePath },
    });

    if (!fileRecord) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Clean up custom OCR files if they exist
    if (fileRecord.originalDocPath) {
      try {
        await fs.unlink(fileRecord.originalDocPath);
      } catch (err) {
        console.error("Error deleting original doc:", err);
      }
    }

    if (fileRecord.ocrOutputPath) {
      try {
        await fs.unlink(fileRecord.ocrOutputPath);
      } catch (err) {
        console.error("Error deleting OCR output:", err);
      }
    }

    // Delete all custom OCR chunks
    await prisma.documentChunk.deleteMany({
      where: {
        filePath,
        chunkType: { in: ["summary", "content"] },
      },
    });

    // Update the file record to revert to paperless
    await prisma.indexedFile.update({
      where: { filePath },
      data: {
        useCustomOcr: false,
        customOcrStatus: null,
        originalDocPath: null,
        ocrOutputPath: null,
        extractedDate: null,
        extractedTags: null,
        documentType: null,
        documentSummary: null,
        sourceOverride: null,
        source: "paperless",
      },
    });

    // Trigger re-indexing with original Paperless content
    const { scanPaperlessDocuments } = await import("@/lib/indexer");
    await scanPaperlessDocuments();

    return NextResponse.json({
      message: "Successfully reverted to Paperless OCR",
    });
  } catch (error) {
    console.error("Error reverting OCR:", error);
    return NextResponse.json(
      {
        error: "Failed to revert OCR",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
