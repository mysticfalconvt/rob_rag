import prisma from "../prisma";
import type { Channel } from "./types";

/**
 * Resolve (or create) the conversation for this run. Unifies persistence across
 * all channels — Matrix and scheduled runs are now DB-backed like web, instead
 * of the old in-memory 30-minute map / `convId = null` behaviour.
 *
 * - web:       use the provided id (verifying ownership) or create a new one.
 * - matrix:    reuse the newest conversation for (room, user), else create one.
 * - scheduled: reuse the newest conversation for (room, user), else create one.
 */
export async function resolveConversation(opts: {
  channel: Channel;
  userId: string;
  conversationId?: string | null;
  matrixRoomId?: string;
  /** When set, scope the conversation to a Matrix thread (its own history). */
  matrixThreadId?: string | null;
  firstMessageText: string;
}): Promise<string> {
  const {
    channel,
    userId,
    conversationId,
    matrixRoomId,
    matrixThreadId = null,
    firstMessageText,
  } = opts;

  if (conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conversation || conversation.userId !== userId) {
      throw new Error("Conversation not found or access denied");
    }
    return conversationId;
  }

  const title =
    firstMessageText.substring(0, 50) +
    (firstMessageText.length > 50 ? "..." : "");

  if ((channel === "matrix" || channel === "scheduled") && matrixRoomId) {
    // A threaded message gets its own per-thread conversation; unthreaded
    // messages share the room-level conversation (matrixThreadId = null).
    const existing = await prisma.conversation.findFirst({
      where: { matrixRoomId, userId, channel, matrixThreadId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await prisma.conversation.create({
      data: {
        userId,
        title: title || "Matrix conversation",
        channel,
        matrixRoomId,
        matrixThreadId,
      },
    });
    return created.id;
  }

  const created = await prisma.conversation.create({
    data: { userId, title, channel },
  });
  return created.id;
}

/**
 * Start a fresh Matrix conversation for a room+user (used by the `#clear`
 * command). The new (empty) conversation becomes the newest, so subsequent
 * messages attach to it and history effectively resets.
 */
export async function startFreshMatrixConversation(
  userId: string,
  matrixRoomId: string,
): Promise<string> {
  const created = await prisma.conversation.create({
    data: {
      userId,
      title: "Matrix conversation",
      channel: "matrix",
      matrixRoomId,
    },
  });
  return created.id;
}

/**
 * Find the conversation for a Matrix thread (any user), if the bot has an
 * ongoing conversation in it — i.e. the bot has replied in this thread before.
 * Returns the conversation id, or null.
 */
export async function findMatrixThreadConversation(
  matrixRoomId: string,
  matrixThreadId: string,
): Promise<string | null> {
  const conv = await prisma.conversation.findFirst({
    where: { matrixRoomId, matrixThreadId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return conv?.id ?? null;
}

/** Load recent conversation history in the shape the agent expects. */
export async function loadConversationHistory(
  conversationId: string,
  limit = 20,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  const recent = messages.slice(-limit);
  return recent.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
}

export async function saveUserMessage(conversationId: string, content: string) {
  return prisma.message.create({
    data: { conversationId, role: "user", content },
  });
}

export async function createAssistantMessage(conversationId: string) {
  return prisma.message.create({
    data: {
      conversationId,
      role: "assistant",
      content: "",
      sources: JSON.stringify([]),
    },
  });
}

export async function updateAssistantMessage(
  messageId: string,
  content: string,
  sources?: unknown,
) {
  return prisma.message.update({
    where: { id: messageId },
    data: {
      content,
      ...(sources !== undefined ? { sources: JSON.stringify(sources) } : {}),
    },
  });
}

export async function touchConversation(conversationId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}
