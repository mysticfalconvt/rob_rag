import { chatModel } from "./ai";
import { HumanMessage } from "@langchain/core/messages";

interface Message {
  role: string;
  content: string;
}

/**
 * Approximate token count (rough estimate: 1 token ≈ 4 characters)
 * For more accurate counting, you'd use tiktoken or similar
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate total tokens in a message array
 */
export function calculateMessageTokens(messages: Message[]): number {
  return messages.reduce(
    (total, msg) => total + estimateTokenCount(msg.content),
    0,
  );
}

/**
 * Sliding window approach: Keep most recent N messages
 * Simple but effective for maintaining recent context
 */
export function applySlidingWindow(
  messages: Message[],
  maxMessages: number = 20,
): Message[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  // Keep the last N messages
  return messages.slice(-maxMessages);
}

/**
 * Token-based sliding window: Keep messages within token budget
 */
export function applyTokenWindow(
  messages: Message[],
  maxTokens: number = 4000, // Conservative limit for most models
  systemPromptTokens: number = 0,
): Message[] {
  if (messages.length === 0) return messages;

  // Always keep the last message (current question)
  const result: Message[] = [];
  let tokenCount = systemPromptTokens;

  // Work backwards from the most recent message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokenCount(messages[i].content);

    if (tokenCount + msgTokens > maxTokens) {
      // Would exceed limit, stop here
      break;
    }

    result.unshift(messages[i]);
    tokenCount += msgTokens;
  }

  return result;
}

/**
 * Smart context management: Combine sliding window with summarization
 * Keeps recent messages + summary of older ones
 */
export async function applySmartContext(
  messages: Message[],
  maxRecentMessages: number = 10,
  includesSummary: boolean = false,
): Promise<{ messages: Message[]; summary: string | null }> {
  if (messages.length <= maxRecentMessages) {
    return { messages, summary: null };
  }

  // Split into old and recent messages
  const oldMessages = messages.slice(0, -maxRecentMessages);
  const recentMessages = messages.slice(-maxRecentMessages);

  // If we already have a summary, just return recent messages
  if (includesSummary) {
    return { messages: recentMessages, summary: null };
  }

  // Generate summary of old messages
  try {
    const summaryPrompt = `Summarize the following conversation history in 2-3 concise paragraphs. Focus on key topics, decisions, and important information that would be helpful for continuing the conversation:

${oldMessages
  .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
  .join("\n\n")}

Summary:`;

    const response = await chatModel.invoke([new HumanMessage(summaryPrompt)]);
    const summary =
      typeof response.content === "string"
        ? response.content.trim()
        : "Previous conversation covered various topics.";

    console.log(
      `[Context] Summarized ${oldMessages.length} old messages into ${estimateTokenCount(summary)} tokens`,
    );

    return { messages: recentMessages, summary };
  } catch (error) {
    console.error("Error generating conversation summary:", error);
    // Fallback to just recent messages
    return { messages: recentMessages, summary: null };
  }
}

/**
 * Main context management function
 * Chooses strategy based on conversation length and available budget
 */
export async function manageContext(
  messages: Message[],
  systemPrompt: string,
  maxContextTokens: number = 8000, // Adjust based on model
  strategy: "sliding" | "token" | "smart" = "smart",
  slidingWindowSize: number = 10,
): Promise<{
  messages: Message[];
  summary: string | null;
  truncated: boolean;
}> {
  const systemTokens = estimateTokenCount(systemPrompt);
  const availableTokens = maxContextTokens - systemTokens;

  // Calculate current usage
  const currentTokens = calculateMessageTokens(messages);
  const truncated = currentTokens > availableTokens;

  console.log(
    `[Context] Messages: ${messages.length}, Tokens: ${currentTokens}/${maxContextTokens} (System: ${systemTokens})`,
  );

  if (!truncated) {
    return { messages, summary: null, truncated: false };
  }

  // Apply strategy
  switch (strategy) {
    case "sliding":
      const slidingResult = applySlidingWindow(messages, slidingWindowSize);
      console.log(
        `[Context] Applied sliding window: ${messages.length} → ${slidingResult.length} messages`,
      );
      return { messages: slidingResult, summary: null, truncated: true };

    case "token":
      const tokenResult = applyTokenWindow(
        messages,
        availableTokens,
        systemTokens,
      );
      console.log(
        `[Context] Applied token window: ${messages.length} → ${tokenResult.length} messages`,
      );
      return { messages: tokenResult, summary: null, truncated: true };

    case "smart":
      const { messages: smartMessages, summary } = await applySmartContext(
        messages,
        slidingWindowSize,
      );
      console.log(
        `[Context] Applied smart context: ${messages.length} → ${smartMessages.length} messages + summary`,
      );
      return { messages: smartMessages, summary, truncated: true };

    default:
      return { messages, summary: null, truncated: false };
  }
}
