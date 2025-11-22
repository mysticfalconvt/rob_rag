import { z } from "zod";

const envSchema = z.object({
  LM_STUDIO_API_URL: z.string().url().default("http://localhost:1234/v1"),
  LM_STUDIO_API_KEY: z.string().optional(),
  QDRANT_URL: z.string().url().default("http://localhost:6333"),
  DOCUMENTS_FOLDER_PATH: z.string().default("./documents"),
  EMBEDDING_MODEL_NAME: z.string().default("nomic-embed-text"),
  CHAT_MODEL_NAME: z.string().default("llama-3.2-1b-instruct"),
  APP_NAME: z.string().default("RobRAG"),
});

export const config = envSchema.parse({
  LM_STUDIO_API_URL: process.env.LM_STUDIO_API_URL,
  LM_STUDIO_API_KEY: process.env.LM_STUDIO_API_KEY,
  QDRANT_URL: process.env.QDRANT_URL,
  DOCUMENTS_FOLDER_PATH: process.env.DOCUMENTS_FOLDER_PATH,
  EMBEDDING_MODEL_NAME: process.env.EMBEDDING_MODEL_NAME,
  CHAT_MODEL_NAME: process.env.CHAT_MODEL_NAME,
  APP_NAME: process.env.APP_NAME,
});

// Get active configuration from database with fallback to env vars
export async function getActiveConfig() {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    await prisma.$disconnect();

    if (settings) {
      return {
        ...config,
        EMBEDDING_MODEL_NAME: settings.embeddingModel,
        CHAT_MODEL_NAME: settings.chatModel,
        EMBEDDING_MODEL_DIMENSION: settings.embeddingModelDimension,
      };
    }
  } catch (error) {
    console.error(
      "Failed to load settings from database, using env vars:",
      error,
    );
  }

  return {
    ...config,
    EMBEDDING_MODEL_DIMENSION: 1024,
  };
}
