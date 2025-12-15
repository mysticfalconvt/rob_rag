import fs from "node:fs/promises";
import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Require authentication
    await requireAuth(req);

    const { id: paperlessId } = await params;

    // Find the file record
    const fileRecord = await prisma.indexedFile.findFirst({
      where: {
        paperlessId: parseInt(paperlessId),
        useCustomOcr: true,
      },
    });

    if (!fileRecord || !fileRecord.originalDocPath) {
      return NextResponse.json(
        { error: "Original document not found" },
        { status: 404 },
      );
    }

    // Read the original PDF file
    const fileBuffer = await fs.readFile(fileRecord.originalDocPath);

    // Return the PDF with appropriate headers
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="document-${paperlessId}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching original document:", error);
    return NextResponse.json(
      { error: "Failed to fetch original document" },
      { status: 500 },
    );
  }
}
