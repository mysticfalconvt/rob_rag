import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: {
        maxContextTokens: true,
        contextStrategy: true,
        slidingWindowSize: true,
        enableContextSummary: true,
      },
    });

    return NextResponse.json({
      maxContextTokens: settings?.maxContextTokens ?? 8000,
      contextStrategy: settings?.contextStrategy ?? "smart",
      slidingWindowSize: settings?.slidingWindowSize ?? 10,
      enableContextSummary: settings?.enableContextSummary ?? true,
    });
  } catch (error) {
    console.error("Error fetching context settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch context settings" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      maxContextTokens,
      contextStrategy,
      slidingWindowSize,
      enableContextSummary,
    } = body;

    // Validate inputs
    if (
      maxContextTokens !== undefined &&
      (maxContextTokens < 1000 || maxContextTokens > 50000)
    ) {
      return NextResponse.json(
        { error: "maxContextTokens must be between 1000 and 50000" },
        { status: 400 },
      );
    }

    if (
      contextStrategy !== undefined &&
      !["sliding", "token", "smart"].includes(contextStrategy)
    ) {
      return NextResponse.json(
        { error: "Invalid contextStrategy" },
        { status: 400 },
      );
    }

    if (
      slidingWindowSize !== undefined &&
      (slidingWindowSize < 1 || slidingWindowSize > 50)
    ) {
      return NextResponse.json(
        { error: "slidingWindowSize must be between 1 and 50" },
        { status: 400 },
      );
    }

    // Get or create settings
    let settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings) {
      // Create default settings if they don't exist
      settings = await prisma.settings.create({
        data: {
          id: "singleton",
          embeddingModel: "nomic-ai/nomic-embed-text-v1.5-GGUF",
          chatModel: "meta-llama-3.1-8b-instruct",
          embeddingModelDimension: 768,
        },
      });
    }

    // Update context settings
    const updatedSettings = await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        maxContextTokens:
          maxContextTokens !== undefined ? maxContextTokens : undefined,
        contextStrategy:
          contextStrategy !== undefined ? contextStrategy : undefined,
        slidingWindowSize:
          slidingWindowSize !== undefined ? slidingWindowSize : undefined,
        enableContextSummary:
          enableContextSummary !== undefined ? enableContextSummary : undefined,
      },
    });

    return NextResponse.json({
      maxContextTokens: updatedSettings.maxContextTokens,
      contextStrategy: updatedSettings.contextStrategy,
      slidingWindowSize: updatedSettings.slidingWindowSize,
      enableContextSummary: updatedSettings.enableContextSummary,
    });
  } catch (error) {
    console.error("Error updating context settings:", error);
    return NextResponse.json(
      { error: "Failed to update context settings" },
      { status: 500 },
    );
  }
}
