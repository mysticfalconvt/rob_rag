import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getPaperlessClient } from "@/lib/paperless";
import prisma from "@/lib/prisma";
import { qdrantClient } from "@/lib/qdrant";

export async function GET() {
  try {
    // 1. Check Qdrant
    let qdrantStatus = "disconnected";
    try {
      await qdrantClient.getCollections();
      qdrantStatus = "connected";
    } catch (e) {
      console.error("Qdrant check failed:", e);
    }

    // 2. Check LM Studio
    let lmStudioStatus = "disconnected";
    try {
      const res = await fetch(`${config.LM_STUDIO_API_URL}/models`);
      if (res.ok) lmStudioStatus = "connected";
    } catch (e) {
      console.error("LM Studio check failed:", e);
    }

    // 3. Check Paperless-ngx
    let paperlessStatus:
      | "connected"
      | "disconnected"
      | "not_configured"
      | "disabled" = "not_configured";
    let paperlessDocCount = 0;

    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
      });

      if (settings?.paperlessUrl && settings.paperlessApiToken) {
        if (!settings.paperlessEnabled) {
          paperlessStatus = "disabled";
        } else {
          const client = await getPaperlessClient();
          if (client) {
            const isConnected = await client.testConnection();
            paperlessStatus = isConnected ? "connected" : "disconnected";

            if (isConnected) {
              paperlessDocCount = await prisma.indexedFile.count({
                where: { source: "paperless" },
              });
            }
          } else {
            paperlessStatus = "disconnected";
          }
        }
      }
    } catch (e) {
      console.error("Paperless-ngx check failed:", e);
      paperlessStatus = "disconnected";
    }

    // 4. Get Stats
    const fileCount = await prisma.indexedFile.count();
    const chunkStats = await prisma.indexedFile.aggregate({
      _sum: { chunkCount: true },
    });

    return NextResponse.json({
      qdrant: qdrantStatus,
      lmStudio: lmStudioStatus,
      paperless: paperlessStatus,
      totalFiles: fileCount,
      totalChunks: chunkStats._sum.chunkCount || 0,
      paperlessDocuments: paperlessDocCount,
      config: {
        embeddingModel: config.EMBEDDING_MODEL_NAME,
        chatModel: config.CHAT_MODEL_NAME,
      },
    });
  } catch (error) {
    console.error("Error fetching status:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
