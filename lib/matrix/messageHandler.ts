import { type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk";
import { resolveMatrixIdentity } from "../agent/identity";
import {
  loadConversationHistory,
  resolveConversation,
  startFreshMatrixConversation,
} from "../agent/persistence";
import { runAgent } from "../agent/runAgent";
import prisma from "../prisma";
import { matrixClient } from "./client";
import { sendFormattedMessage } from "./sender";

/**
 * Rate limiting per room
 */
const roomRateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // Max 10 messages per minute per room

/**
 * Check if a room is rate limited
 */
function isRateLimited(roomId: string): boolean {
  const now = Date.now();
  const limit = roomRateLimits.get(roomId);

  if (!limit || now > limit.resetTime) {
    roomRateLimits.set(roomId, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    });
    return false;
  }

  if (limit.count >= RATE_LIMIT_MAX) {
    return true;
  }

  limit.count++;
  return false;
}

/**
 * Track processed events to prevent duplicates.
 * Uses globalThis to survive across Next.js module re-evaluations.
 */
const _global = globalThis as any;
if (!_global.__robrag_processedEvents) {
  _global.__robrag_processedEvents = new Set<string>();
}
const processedEvents: Set<string> = _global.__robrag_processedEvents;
const EVENT_CACHE_SIZE = 1000;

/**
 * Light safety net: strip any tool-call syntax a weak model might leak into
 * prose. The real tool-calling loop keeps tool syntax out of the answer, so this
 * should almost never fire — kept as insurance during rollout.
 */
function scrubToolSyntax(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/commentary\s+to=\S+\s+code\{[^}]*\}/g, "").trim();
  cleaned = cleaned
    .replace(
      /<\/?(?:tool_call|function_call|tool_use)[^>]*>[\s\S]*?<\/(?:tool_call|function_call|tool_use)>/g,
      "",
    )
    .trim();
  cleaned = cleaned
    .replace(
      /\{"(?:name|tool)":\s*"[^"]+",\s*"(?:arguments|parameters|input)":\s*\{[^}]*\}\s*\}/g,
      "",
    )
    .trim();
  if (!cleaned || cleaned.length < 5) {
    return "I've processed your request, but encountered an issue generating a response. Please try again.";
  }
  return cleaned;
}

/**
 * Run one turn through the unified agent for a Matrix message and reply.
 */
async function runMatrixTurn(opts: {
  roomId: string;
  sender: string;
  displayName: string;
  messageText: string;
  useRag: boolean;
  webIntent?: "search" | "research";
  /** Thread root event id — reply in this thread and scope history to it. */
  threadRootId?: string;
}): Promise<void> {
  const {
    roomId,
    sender,
    displayName,
    messageText,
    useRag,
    webIntent,
    threadRootId,
  } = opts;

  const { userId, userProfile } = await resolveMatrixIdentity(
    sender,
    displayName,
  );
  const conversationId = await resolveConversation({
    channel: "matrix",
    userId,
    matrixRoomId: roomId,
    matrixThreadId: threadRootId ?? null,
    firstMessageText: messageText,
  });
  const history = await loadConversationHistory(conversationId);

  const result = await runAgent({
    messages: [...history, { role: "user", content: messageText }],
    channel: "matrix",
    userId,
    userProfile,
    conversationId,
    matrixRoomId: roomId,
    sourceFilter: useRag ? undefined : "none",
    webIntent,
  });

  await sendFormattedMessage(
    roomId,
    scrubToolSyntax(result.text),
    result.sources,
    threadRootId,
  );
}

/**
 * Resolve the thread to reply in. If the incoming message is already in a
 * thread, always reply there. Otherwise, only start a new thread (rooted at the
 * message) when the room has threading enabled.
 */
function resolveThreadRoot(
  content: any,
  eventId: string,
  useThreads: boolean,
): string | undefined {
  const rel = content?.["m.relates_to"];
  if (rel?.rel_type === "m.thread" && rel.event_id) {
    return rel.event_id;
  }
  return useThreads ? eventId : undefined;
}

/** Whether this message mentions the bot (explicit m.mentions or by name). */
function isBotMentioned(
  roomId: string,
  content: any,
  messageText: string,
): boolean {
  const client = matrixClient.getClient();
  const botUserId = client?.getUserId();
  if (!botUserId) return false;

  const mentioned = content?.["m.mentions"]?.user_ids;
  if (Array.isArray(mentioned) && mentioned.includes(botUserId)) return true;

  const localpart = botUserId.replace(/^@/, "").split(":")[0];
  const displayName = client?.getRoom(roomId)?.getMember(botUserId)?.name;
  const needles = [botUserId, localpart, displayName]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  const body = messageText.toLowerCase();
  return needles.some((n) => n.length > 1 && body.includes(n));
}

/**
 * Process an incoming Matrix message
 */
async function handleMessage(event: MatrixEvent): Promise<void> {
  try {
    const client = matrixClient.getClient();
    if (!client) return;

    const eventId = event.getId();
    if (!eventId) return;

    if (processedEvents.has(eventId)) return;
    processedEvents.add(eventId);
    if (processedEvents.size > EVENT_CACHE_SIZE) {
      const toRemove = Array.from(processedEvents).slice(
        0,
        processedEvents.size - EVENT_CACHE_SIZE,
      );
      toRemove.forEach((id) => processedEvents.delete(id));
    }

    const roomId = event.getRoomId();
    const sender = event.getSender();
    const content = event.getContent();
    const messageText = content.body;

    if (!roomId || !sender || !messageText) return;
    if (sender === client.getUserId()) return; // ignore our own messages

    const trimmedMessage = messageText.trim();
    const lowerTrimmed = trimmedMessage.toLowerCase();

    // Room settings (may be null for an unregistered room — commands still work).
    const room = await prisma.matrixRoom.findUnique({ where: { roomId } });
    const useThreads = room?.useThreads ?? false;
    const threadRootId = resolveThreadRoot(content, eventId, useThreads);

    // #clear — start a fresh conversation for this sender in this room.
    if (lowerTrimmed === "#clear") {
      const displayName = await getMatrixUserDisplayName(roomId, sender);
      const { userId } = await resolveMatrixIdentity(sender, displayName);
      await startFreshMatrixConversation(userId, roomId);
      await sendFormattedMessage(
        roomId,
        "✅ Context cleared. Starting fresh conversation.",
        undefined,
        threadRootId,
      );
      return;
    }

    // #search / #research web commands.
    if (lowerTrimmed.startsWith("#search ")) {
      const q = trimmedMessage.substring(8).trim();
      if (!q) {
        await sendFormattedMessage(
          roomId,
          "⚠️ Please provide a search query. Usage: `#search your query here`",
          undefined,
          threadRootId,
        );
        return;
      }
      await handleWebCommand(roomId, sender, q, "search", threadRootId);
      return;
    }
    if (lowerTrimmed.startsWith("#research ")) {
      const q = trimmedMessage.substring(10).trim();
      if (!q) {
        await sendFormattedMessage(
          roomId,
          "⚠️ Please provide a research query. Usage: `#research your query here`",
          undefined,
          threadRootId,
        );
        return;
      }
      await handleWebCommand(roomId, sender, q, "research", threadRootId);
      return;
    }

    // Regular message — room must be registered + enabled.
    if (!room || !room.enabled) return;

    // Mention-only rooms: ignore messages that don't mention the bot.
    if (room.mentionsOnly && !isBotMentioned(roomId, content, messageText)) {
      return;
    }

    const useRag = room.useRag ?? true;

    if (isRateLimited(roomId)) {
      await sendFormattedMessage(
        roomId,
        "⚠️ Rate limit exceeded. Please wait a moment before sending more messages.",
        undefined,
        threadRootId,
      );
      return;
    }

    await matrixClient.sendTyping(roomId, true);
    const typingInterval = setInterval(async () => {
      try {
        await matrixClient.sendTyping(roomId, true);
      } catch (error) {
        console.error("[Matrix] Error sending typing indicator:", error);
      }
    }, 10000);

    try {
      const displayName = await getMatrixUserDisplayName(roomId, sender);
      await runMatrixTurn({
        roomId,
        sender,
        displayName,
        messageText,
        useRag,
        threadRootId,
      });
    } catch (error) {
      console.error("[Matrix] Error processing message:", error);
      await sendFormattedMessage(
        roomId,
        "❌ Sorry, I encountered an error processing your message. Please try again later.",
      );
    } finally {
      clearInterval(typingInterval);
      await matrixClient.sendTyping(roomId, false);
    }
  } catch (error) {
    console.error("[Matrix] Error in handleMessage:", error);
  }
}

/**
 * Get user display name from Matrix
 */
async function getMatrixUserDisplayName(
  roomId: string,
  userId: string,
): Promise<string> {
  try {
    const client = matrixClient.getClient();
    const room = client?.getRoom(roomId);
    if (!room) return userId;
    const member = room.getMember(userId);
    return member?.name || member?.rawDisplayName || userId;
  } catch (error) {
    console.error("[Matrix] Error getting display name:", error);
    return userId;
  }
}

/**
 * Handle #search and #research web commands
 */
async function handleWebCommand(
  roomId: string,
  sender: string,
  webQuery: string,
  type: "search" | "research",
  threadRootId?: string,
): Promise<void> {
  await matrixClient.sendTyping(roomId, true);
  const typingInterval = setInterval(async () => {
    try {
      await matrixClient.sendTyping(roomId, true);
    } catch (error) {
      console.error("[Matrix] Error sending typing indicator:", error);
    }
  }, 10000);

  try {
    const displayName = await getMatrixUserDisplayName(roomId, sender);
    const room = await prisma.matrixRoom.findUnique({ where: { roomId } });
    const useRag = room?.useRag ?? true;
    await runMatrixTurn({
      roomId,
      sender,
      displayName,
      messageText: webQuery,
      useRag,
      webIntent: type,
      threadRootId,
    });
  } catch (error) {
    console.error(`[Matrix] Error processing #${type} command:`, error);
    await sendFormattedMessage(
      roomId,
      `❌ Sorry, I encountered an error processing your ${type === "research" ? "research" : "web search"}. Please try again later.`,
      undefined,
      threadRootId,
    );
  } finally {
    clearInterval(typingInterval);
    await matrixClient.sendTyping(roomId, false);
  }
}

// Use globalThis to survive across Next.js module re-evaluations in production
if (_global.__robrag_handlerInitialized === undefined)
  _global.__robrag_handlerInitialized = false;
if (_global.__robrag_registeredClient === undefined)
  _global.__robrag_registeredClient = null;

/**
 * Initialize message handler
 * This should be called after the Matrix client is ready
 */
export function initializeMessageHandler(): void {
  const client = matrixClient.getClient();

  if (!client) {
    console.error(
      "[Matrix] Cannot initialize message handler: client not ready",
    );
    return;
  }

  if (
    _global.__robrag_handlerInitialized &&
    _global.__robrag_registeredClient === client
  ) {
    console.log(
      "[Matrix] Message handler already initialized for this client, skipping",
    );
    return;
  }

  if (
    _global.__robrag_registeredClient &&
    _global.__robrag_registeredClient !== client
  ) {
    console.log("[Matrix] Client changed, removing old listener");
    try {
      _global.__robrag_registeredClient.removeAllListeners(RoomEvent.Timeline);
    } catch (error) {
      console.error("[Matrix] Failed to remove old listeners:", error);
    }
  }

  console.log("[Matrix] Registering message handler");

  client.on(
    RoomEvent.Timeline as any,
    async (event: MatrixEvent, _room: Room | undefined) => {
      if (event.getType() !== "m.room.message") return;
      const content = event.getContent();
      if (content.msgtype !== "m.text") return;
      await handleMessage(event);
    },
  );

  _global.__robrag_handlerInitialized = true;
  _global.__robrag_registeredClient = client;
}
