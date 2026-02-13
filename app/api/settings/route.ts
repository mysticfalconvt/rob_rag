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
        fastChatModel: null,
        visionModel: null,
        embeddingModelDimension: 1024,
        isDefault: true,
        paperlessUrl: null,
        paperlessExternalUrl: null,
        paperlessEnabled: false,
        paperlessConfigured: false,
        customOcrEnabled: false,
      });
    }

    return NextResponse.json({
      embeddingModel: settings.embeddingModel,
      chatModel: settings.chatModel,
      fastChatModel: settings.fastChatModel,
      visionModel: settings.visionModel,
      embeddingModelDimension: settings.embeddingModelDimension,
      isDefault: false,
      paperlessUrl: settings.paperlessUrl,
      paperlessExternalUrl: settings.paperlessExternalUrl,
      paperlessEnabled: settings.paperlessEnabled,
      paperlessConfigured: !!settings.paperlessApiToken,
      customOcrEnabled: settings.customOcrEnabled,
      syncedFilesConfig: settings.syncedFilesConfig,
      paperlessSyncEnabled: settings.paperlessSyncEnabled,
      paperlessSyncInterval: settings.paperlessSyncInterval,
      paperlessSyncLastRun: settings.paperlessSyncLastRun,
      paperlessSyncFilters: settings.paperlessSyncFilters,
      paperlessAutoOcr: settings.paperlessAutoOcr,
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
      fastChatModel,
      visionModel,
      embeddingModelDimension,
      paperlessUrl,
      paperlessExternalUrl,
      paperlessApiToken,
      paperlessEnabled,
      customOcrEnabled,
      paperlessSyncEnabled,
      paperlessSyncInterval,
      paperlessSyncFilters,
      paperlessAutoOcr,
      syncedFilesConfig,
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

    // Check if settings exist
    const existingSettings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    // Prepare update data - only include fields that are provided
    const updateData: any = {};

    if (embeddingModel !== undefined) {
      updateData.embeddingModel = embeddingModel;
    }
    if (chatModel !== undefined) {
      updateData.chatModel = chatModel;
    }
    if (fastChatModel !== undefined) {
      updateData.fastChatModel = fastChatModel || null;
    }
    if (visionModel !== undefined) {
      updateData.visionModel = visionModel || null;
    }
    if (embeddingModelDimension !== undefined) {
      updateData.embeddingModelDimension = embeddingModelDimension;
    }

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
    if (customOcrEnabled !== undefined) {
      updateData.customOcrEnabled = customOcrEnabled;
    }

    // Handle Paperless sync settings
    if (paperlessSyncEnabled !== undefined) {
      updateData.paperlessSyncEnabled = paperlessSyncEnabled;
    }
    if (paperlessSyncInterval !== undefined) {
      updateData.paperlessSyncInterval = paperlessSyncInterval;
    }
    if (paperlessSyncFilters !== undefined) {
      updateData.paperlessSyncFilters = paperlessSyncFilters;
    }
    if (paperlessAutoOcr !== undefined) {
      updateData.paperlessAutoOcr = paperlessAutoOcr;
    }
    if (syncedFilesConfig !== undefined) {
      updateData.syncedFilesConfig = syncedFilesConfig;
    }

    let settings;
    if (existingSettings) {
      // Update existing settings
      settings = await prisma.settings.update({
        where: { id: "singleton" },
        data: updateData,
      });
    } else {
      // Create new settings - require embeddingModel and chatModel
      if (!embeddingModel || !chatModel) {
        return NextResponse.json(
          { error: "embeddingModel and chatModel are required for initial setup" },
          { status: 400 }
        );
      }
      settings = await prisma.settings.create({
        data: {
          id: "singleton",
          embeddingModel,
          chatModel,
          fastChatModel: fastChatModel || null,
          visionModel: visionModel || null,
          embeddingModelDimension: embeddingModelDimension || 1024,
          paperlessUrl: paperlessUrl || null,
          paperlessExternalUrl: paperlessExternalUrl || null,
          paperlessApiToken: paperlessApiToken || null,
          paperlessEnabled: paperlessEnabled || false,
          customOcrEnabled: customOcrEnabled || false,
        },
      });
    }

    return NextResponse.json({
      embeddingModel: settings.embeddingModel,
      chatModel: settings.chatModel,
      fastChatModel: settings.fastChatModel,
      visionModel: settings.visionModel,
      embeddingModelDimension: settings.embeddingModelDimension,
      paperlessUrl: settings.paperlessUrl,
      paperlessExternalUrl: settings.paperlessExternalUrl,
      paperlessEnabled: settings.paperlessEnabled,
      paperlessConfigured: !!settings.paperlessApiToken,
      customOcrEnabled: settings.customOcrEnabled,
      syncedFilesConfig: settings.syncedFilesConfig,
      paperlessSyncEnabled: settings.paperlessSyncEnabled,
      paperlessSyncInterval: settings.paperlessSyncInterval,
      paperlessSyncLastRun: settings.paperlessSyncLastRun,
      paperlessSyncFilters: settings.paperlessSyncFilters,
      paperlessAutoOcr: settings.paperlessAutoOcr,
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
