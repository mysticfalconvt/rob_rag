import prisma from "./prisma";
import { chatModel } from "./ai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

interface Message {
  role: string;
  content: string;
}

/**
 * Get user profile for contextualization
 */
export async function getUserProfile() {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: {
        userName: true,
        userBio: true,
      },
    });

    return {
      userName: settings?.userName || null,
      userBio: settings?.userBio || null,
    };
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return { userName: null, userBio: null };
  }
}

/**
 * Build user context string for first message
 */
export function buildUserContext(
  userName: string | null,
  userBio: string | null,
): string {
  const parts: string[] = [];

  if (userName) {
    parts.push(`User: ${userName}`);
  }

  if (userBio) {
    parts.push(`Background: ${userBio}`);
  }

  return parts.length > 0 ? parts.join("\n") : "";
}

/**
 * Build search query with user context for first message
 */
export function buildSearchQueryWithUserContext(
  query: string,
  userName: string | null,
  userBio: string | null,
): string {
  const userContext = buildUserContext(userName, userBio);

  if (!userContext) {
    return query;
  }

  return `${userContext}\n\nQuestion: ${query}`;
}

/**
 * Rephrase follow-up question with conversation context
 * Only rephrases if the question seems to need context
 */
export async function rephraseQuestionIfNeeded(
  currentQuery: string,
  conversationHistory: Message[],
): Promise<{ rephrased: string; wasRephrased: boolean }> {
  // Don't rephrase if it's the first message
  if (conversationHistory.length === 0) {
    return { rephrased: currentQuery, wasRephrased: false };
  }

  // Check if question needs rephrasing (has pronouns or references)
  const needsContext =
    /\b(it|this|that|these|those|they|them|he|she|his|her|their)\b/i.test(
      currentQuery,
    ) ||
    currentQuery.toLowerCase().startsWith("what about") ||
    currentQuery.toLowerCase().startsWith("how about") ||
    currentQuery.toLowerCase().startsWith("and ") ||
    currentQuery.length < 20; // Short questions likely need context

  if (!needsContext) {
    return { rephrased: currentQuery, wasRephrased: false };
  }

  try {
    // Get last few messages for context (max 5)
    const recentMessages = conversationHistory.slice(-5);

    const rephrasePrompt = `Given the following conversation history, rephrase the last user question to be self-contained and include necessary context. Only output the rephrased question, nothing else.

Conversation History:
${recentMessages
  .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
  .join("\n")}

Current Question: ${currentQuery}

Rephrased Question:`;

    const response = await chatModel.invoke([new HumanMessage(rephrasePrompt)]);

    const rephrasedText =
      typeof response.content === "string"
        ? response.content.trim()
        : currentQuery;

    console.log(
      `[Context] Original: "${currentQuery}" → Rephrased: "${rephrasedText}"`,
    );

    return { rephrased: rephrasedText, wasRephrased: true };
  } catch (error) {
    console.error("Error rephrasing question:", error);
    return { rephrased: currentQuery, wasRephrased: false };
  }
}

/**
 * Extract and update conversation topics
 */
export async function updateConversationTopics(
  conversationId: string,
  newMessage: string,
): Promise<string[]> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { topics: true, messages: true },
    });

    if (!conversation) {
      return [];
    }

    const existingTopics = conversation.topics
      ? JSON.parse(conversation.topics)
      : [];

    // Extract topics using LLM (only if we have a few messages)
    if (
      conversation.messages.length >= 2 &&
      conversation.messages.length <= 5
    ) {
      try {
        const topicPrompt = `Based on this conversation, extract 2-4 main topics or themes. Return only a JSON array of topic strings, nothing else.

Conversation:
${conversation.messages
  .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
  .join("\n")}

New message: ${newMessage}

Topics (as JSON array):`;

        const response = await chatModel.invoke([
          new HumanMessage(topicPrompt),
        ]);

        const responseText =
          typeof response.content === "string" ? response.content.trim() : "[]";

        // Try to parse JSON array
        const match = responseText.match(/\[.*\]/s);
        if (match) {
          const topics = JSON.parse(match[0]);
          if (Array.isArray(topics)) {
            await prisma.conversation.update({
              where: { id: conversationId },
              data: { topics: JSON.stringify(topics) },
            });
            console.log(
              `[Topics] Updated for conversation: ${topics.join(", ")}`,
            );
            return topics;
          }
        }
      } catch (error) {
        console.error("Error extracting topics:", error);
      }
    }

    return existingTopics;
  } catch (error) {
    console.error("Error updating conversation topics:", error);
    return [];
  }
}
