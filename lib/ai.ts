import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";
import { config, getActiveConfig } from "./config";
import type { LLMCallMetrics } from "./llmTracking";

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
    modelName:
      activeConfig.FAST_CHAT_MODEL_NAME || activeConfig.CHAT_MODEL_NAME,
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
export async function generateEmbedding(
  text: string,
  onMetrics?: (metrics: LLMCallMetrics) => void | Promise<void>
): Promise<number[]> {
  const startTime = Date.now();
  try {
    // Get active config to respect database settings
    const activeConfig = await getActiveConfig();

    // Remove newlines to improve embedding quality
    const cleanText = text.replace(/\n/g, " ");

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
      const errorMsg = `Embedding API returned ${response.status}: ${response.statusText}`;
      const duration = Date.now() - startTime;

      if (onMetrics) {
        await onMetrics({
          model: activeConfig.EMBEDDING_MODEL_NAME,
          promptTokens: estimateTokens(cleanText),
          completionTokens: 0,
          duration,
          error: errorMsg,
        });
      }

      throw new Error(errorMsg);
    }

    const data = await response.json();
    const embedding = data.data[0].embedding;
    const duration = Date.now() - startTime;

    // Track metrics if callback provided
    if (onMetrics) {
      await onMetrics({
        model: activeConfig.EMBEDDING_MODEL_NAME,
        promptTokens: data.usage?.prompt_tokens || estimateTokens(cleanText),
        completionTokens: 0, // Embeddings don't generate tokens
        duration,
      });
    }

    return embedding;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (onMetrics && error instanceof Error) {
      const activeConfig = await getActiveConfig();
      await onMetrics({
        model: activeConfig.EMBEDDING_MODEL_NAME,
        promptTokens: estimateTokens(text),
        completionTokens: 0,
        duration,
        error: error.message,
      });
    }
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

/**
 * Simple token estimation (roughly 4 chars per token for English)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for messages array
 */
export function estimateMessageTokens(messages: BaseMessage[]): number {
  return messages.reduce((total, msg) => {
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    return total + estimateTokens(content);
  }, 0);
}

/**
 * Wrapper to track a chat model invocation
 */
export async function trackChatInvoke(
  model: ChatOpenAI,
  messages: BaseMessage[],
  onMetrics?: (metrics: LLMCallMetrics) => void | Promise<void>
) {
  const startTime = Date.now();
  const modelName = (model as any).modelName || (model as any).model || "unknown";

  try {
    const response = await model.invoke(messages);
    const duration = Date.now() - startTime;

    const responseContent = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    const lastMsg = messages.length > 0 ? messages[messages.length - 1].content : "";
    const lastMsgPreview = typeof lastMsg === "string" ? lastMsg.substring(0, 100) : "";

    const metrics: LLMCallMetrics = {
      model: modelName,
      promptTokens: (response as any).usage_metadata?.input_tokens || estimateMessageTokens(messages),
      completionTokens: (response as any).usage_metadata?.output_tokens || estimateTokens(responseContent),
      duration,
      callPayload: JSON.stringify({
        messageCount: messages.length,
        lastMessagePreview: lastMsgPreview
      })
    };

    if (onMetrics) {
      await onMetrics(metrics);
    }

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;

    if (onMetrics && error instanceof Error) {
      await onMetrics({
        model: modelName,
        promptTokens: estimateMessageTokens(messages),
        completionTokens: 0,
        duration,
        error: error.message,
      });
    }

    throw error;
  }
}
