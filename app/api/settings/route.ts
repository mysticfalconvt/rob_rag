import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import prisma from "@/lib/prisma";
import { requireAuth, requireAdmin } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    // Require authentication to view settings
    await requireAuth(req);

    // Try to get settings from database
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    // If no settings exist, return defaults from env
    if (!settings) {
      return NextResponse.json({
        embeddingModel: config.EMBEDDING_MODEL_NAME,
        chatModel: config.CHAT_MODEL_NAME,
        embeddingModelDimension: 1024,
        isDefault: true,
        paperlessUrl: null,
        paperlessExternalUrl: null,
        paperlessEnabled: false,
        paperlessConfigured: false,
      });
    }

    return NextResponse.json({
      embeddingModel: settings.embeddingModel,
      chatModel: settings.chatModel,
      embeddingModelDimension: settings.embeddingModelDimension,
      isDefault: false,
      paperlessUrl: settings.paperlessUrl,
      paperlessExternalUrl: settings.paperlessExternalUrl,
      paperlessEnabled: settings.paperlessEnabled,
      paperlessConfigured: !!settings.paperlessApiToken,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // Only admins can modify global settings
    await requireAdmin(req);
    const {
      embeddingModel,
      chatModel,
      embeddingModelDimension,
      paperlessUrl,
      paperlessExternalUrl,
      paperlessApiToken,
      paperlessEnabled,
    } = await req.json();

    // Validate Paperless URL if provided
    if (paperlessUrl) {
      try {
        new URL(paperlessUrl);
      } catch (_error) {
        return NextResponse.json(
          { error: "Invalid Paperless-ngx URL format" },
          { status: 400 },
        );
      }
    }

    // Validate Paperless External URL if provided
    if (paperlessExternalUrl) {
      try {
        new URL(paperlessExternalUrl);
      } catch (_error) {
        return NextResponse.json(
          { error: "Invalid Paperless-ngx External URL format" },
          { status: 400 },
        );
      }
    }

    // Prepare update data
    const updateData: any = {
      embeddingModel,
      chatModel,
      embeddingModelDimension: embeddingModelDimension || 1024,
    };

    // Only update Paperless fields if they are provided
    if (paperlessUrl !== undefined) {
      updateData.paperlessUrl = paperlessUrl;
    }
    if (paperlessExternalUrl !== undefined) {
      updateData.paperlessExternalUrl = paperlessExternalUrl;
    }
    if (paperlessApiToken !== undefined) {
      updateData.paperlessApiToken = paperlessApiToken;
    }
    if (paperlessEnabled !== undefined) {
      updateData.paperlessEnabled = paperlessEnabled;
    }

    const settings = await prisma.settings.upsert({
      where: { id: "singleton" },
      update: updateData,
      create: {
        id: "singleton",
        embeddingModel,
        chatModel,
        embeddingModelDimension: embeddingModelDimension || 1024,
        paperlessUrl: paperlessUrl || null,
        paperlessExternalUrl: paperlessExternalUrl || null,
        paperlessApiToken: paperlessApiToken || null,
        paperlessEnabled: paperlessEnabled || false,
      },
    });

    return NextResponse.json({
      embeddingModel: settings.embeddingModel,
      chatModel: settings.chatModel,
      embeddingModelDimension: settings.embeddingModelDimension,
      paperlessUrl: settings.paperlessUrl,
      paperlessExternalUrl: settings.paperlessExternalUrl,
      paperlessEnabled: settings.paperlessEnabled,
      paperlessConfigured: !!settings.paperlessApiToken,
    });
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
    console.error("Error updating settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 },
    );
  }
}
