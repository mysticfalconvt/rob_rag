import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import prisma from "@/lib/prisma";
import { startOcrJob } from "@/lib/visionOcr";

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin (only admins can trigger OCR)
    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
    });

    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { paperlessId } = body;

    if (!paperlessId || typeof paperlessId !== "number") {
      return NextResponse.json(
        { error: "paperlessId is required" },
        { status: 400 },
      );
    }

    // Check if document exists
    const filePath = `paperless://${paperlessId}`;
    const existingFile = await prisma.indexedFile.findUnique({
      where: { filePath },
    });

    if (!existingFile) {
      return NextResponse.json(
        { error: "Document not found in index" },
        { status: 404 },
      );
    }

    // Get vision model from settings
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings?.customOcrEnabled) {
      return NextResponse.json(
        { error: "Custom OCR is not enabled in settings" },
        { status: 400 },
      );
    }

    if (!settings.visionModel) {
      return NextResponse.json(
        { error: "No vision model configured in settings" },
        { status: 400 },
      );
    }

    // Start OCR job
    const jobId = await startOcrJob(paperlessId, settings.visionModel);

    return NextResponse.json({
      jobId,
      message: "OCR processing started",
    });
  } catch (error: any) {
    console.error("Error starting OCR process:", error);
    return NextResponse.json(
      { error: "Failed to start OCR process", details: error.message },
      { status: 500 },
    );
  }
}
