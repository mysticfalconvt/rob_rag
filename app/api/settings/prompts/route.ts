import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPrompts, DEFAULT_PROMPTS } from "@/lib/prompts";

export async function GET() {
  try {
    const prompts = await getPrompts();
    return NextResponse.json(prompts);
  } catch (error) {
    console.error("Error fetching prompts:", error);
    return NextResponse.json(
      { error: "Failed to fetch prompts" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ragSystemPrompt, noSourcesSystemPrompt, titleGenerationPrompt } =
      body;

    // Validate that at least one prompt is provided
    if (
      ragSystemPrompt === undefined &&
      noSourcesSystemPrompt === undefined &&
      titleGenerationPrompt === undefined
    ) {
      return NextResponse.json(
        { error: "At least one prompt must be provided" },
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

    // Update prompts
    const updatedSettings = await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        ragSystemPrompt:
          ragSystemPrompt !== undefined ? ragSystemPrompt : undefined,
        noSourcesSystemPrompt:
          noSourcesSystemPrompt !== undefined
            ? noSourcesSystemPrompt
            : undefined,
        titleGenerationPrompt:
          titleGenerationPrompt !== undefined
            ? titleGenerationPrompt
            : undefined,
      },
    });

    return NextResponse.json({
      ragSystemPrompt:
        updatedSettings.ragSystemPrompt ?? DEFAULT_PROMPTS.ragSystemPrompt,
      noSourcesSystemPrompt:
        updatedSettings.noSourcesSystemPrompt ??
        DEFAULT_PROMPTS.noSourcesSystemPrompt,
      titleGenerationPrompt:
        updatedSettings.titleGenerationPrompt ??
        DEFAULT_PROMPTS.titleGenerationPrompt,
    });
  } catch (error) {
    console.error("Error updating prompts:", error);
    return NextResponse.json(
      { error: "Failed to update prompts" },
      { status: 500 },
    );
  }
}
