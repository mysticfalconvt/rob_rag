import { ChatOpenAI } from "@langchain/openai";
import { config, getActiveConfig } from "./config";

/**
 * Get chat model instance with current configuration
 * This checks database settings first, then falls back to env vars
 */
export async function getChatModel(): Promise<ChatOpenAI> {
  const activeConfig = await getActiveConfig();

  return new ChatOpenAI({
    apiKey: config.LM_STUDIO_API_KEY || "lm-studio",
    configuration: {
      baseURL: config.LM_STUDIO_API_URL,
    },
    modelName: activeConfig.CHAT_MODEL_NAME,
    temperature: 0.7,
  });
}

/**
 * Get fast chat model for auxiliary tasks (rephrasing, title generation, etc.)
 * Falls back to main chat model if no fast model is configured
 */
export async function getFastChatModel(): Promise<ChatOpenAI> {
  const activeConfig = await getActiveConfig();

  return new ChatOpenAI({
    apiKey: config.LM_STUDIO_API_KEY || "lm-studio",
    configuration: {
      baseURL: config.LM_STUDIO_API_URL,
    },
    modelName: activeConfig.FAST_CHAT_MODEL_NAME || activeConfig.CHAT_MODEL_NAME,
    temperature: 0.7,
  });
}

// Legacy export for backwards compatibility (uses env vars only)
// DEPRECATED: Use getChatModel() instead to respect database settings
export const chatModel = new ChatOpenAI({
  apiKey: config.LM_STUDIO_API_KEY || "lm-studio",
  configuration: {
    baseURL: config.LM_STUDIO_API_URL,
  },
  modelName: config.CHAT_MODEL_NAME,
  temperature: 0.7,
});

/**
 * Direct HTTP embedding function (bypasses LangChain due to compatibility issues)
 * This respects database settings for the embedding model
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    // Get active config to respect database settings
    const activeConfig = await getActiveConfig();

    // Remove newlines to improve embedding quality
    const cleanText = text.replace(/\n/g, " ");
    console.log(
      "[Embedding] Generating for text:",
      `${cleanText.substring(0, 100)}...`,
    );

    const response = await fetch(`${config.LM_STUDIO_API_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: activeConfig.EMBEDDING_MODEL_NAME,
        input: cleanText,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Embedding API returned ${response.status}: ${response.statusText}`,
      );
    }

    const data = await response.json();
    const embedding = data.data[0].embedding;

    console.log("[Embedding] Result length:", embedding.length);
    console.log("[Embedding] First 5 values:", embedding.slice(0, 5));
    console.log(
      "[Embedding] Sum:",
      embedding.reduce((a: number, b: number) => a + b, 0),
    );
    console.log(
      "[Embedding] All zeros?",
      embedding.every((v: number) => v === 0),
    );

    return embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw error;
  }
}

export async function getChatCompletion(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
) {
  try {
    // Convert simple messages to LangChain format if needed,
    // but ChatOpenAI supports passing role/content objects directly in invoke usually,
    // or we can use the standard invoke method.
    // However, LangChain expects BaseMessage[] or string.
    // Let's map them.

    // Actually, let's keep it simple and expose the model directly or a wrapper.
    // For now, a wrapper that takes our format.

    const response = await chatModel.invoke(
      messages.map((m) => {
        if (m.role === "user") return ["human", m.content];
        if (m.role === "assistant") return ["ai", m.content];
        return ["system", m.content];
      }) as any, // Type casting for simplicity, LangChain types can be complex
    );

    return response.content;
  } catch (error) {
    console.error("Error getting chat completion:", error);
    throw error;
  }
}
