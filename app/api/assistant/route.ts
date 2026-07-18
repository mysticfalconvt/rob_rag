import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin, requireAuth } from "@/lib/session";

/** Assistant-level settings (currently just the auto-triage toggle). */

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    let autoTriage = true;
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
        select: { assistantAutoTriage: true },
      });
      if (settings) autoTriage = settings.assistantAutoTriage;
    } catch {
      autoTriage = true;
    }
    return NextResponse.json({ autoTriage });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[api/assistant] GET error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { autoTriage } = await req.json();
    if (typeof autoTriage !== "boolean") {
      return NextResponse.json({ error: "autoTriage must be a boolean" }, { status: 400 });
    }

    // Ensure the singleton exists (mirrors app/api/settings/prompts/route.ts).
    const existing = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });
    if (!existing) {
      await prisma.settings.create({
        data: {
          id: "singleton",
          embeddingModel: "nomic-ai/nomic-embed-text-v1.5-GGUF",
          chatModel: "meta-llama-3.1-8b-instruct",
          embeddingModelDimension: 768,
        },
      });
    }

    const updated = await prisma.settings.update({
      where: { id: "singleton" },
      data: { assistantAutoTriage: autoTriage },
      select: { assistantAutoTriage: true },
    });
    return NextResponse.json({ autoTriage: updated.assistantAutoTriage });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "Forbidden: Admin access required" },
          { status: 403 },
        );
      }
    }
    console.error("[api/assistant] POST error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
