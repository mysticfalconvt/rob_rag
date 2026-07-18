import { HumanMessage } from "@langchain/core/messages";
import { type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk";
import { resolveMatrixIdentity } from "../agent/identity";
import {
  findMatrixThreadConversation,
  loadConversationHistory,
  resolveConversation,
  startFreshMatrixConversation,
} from "../agent/persistence";
import { runAgent } from "../agent/runAgent";
import { getFastChatModel } from "../ai";
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

/** How many recent messages to consider for the main-timeline depth decision. */
const MAIN_HISTORY_LOOKBACK = 10;
/** How many recent messages to load for a thread (manageContext trims by tokens). */
const THREAD_HISTORY_LIMIT = 40;

/**
 * Decide how many of the most-recent room messages are relevant context for the
 * new message. A fresh/unrelated question needs 0 (just itself); a follow-up
 * needs the recent turns. Returns a count in [0, history.length]. Defaults to
 * including everything on failure (safer than losing context).
 */
async function selectMainContextDepth(
  history: { role: string; content: string; authorName?: string }[],
  newMessage: string,
  botName: string,
): Promise<number> {
  if (history.length <= 2) return history.length;
  try {
    const numbered = history
      .map((m, i) => {
        const who = m.role === "assistant" ? botName : m.authorName || "User";
        return `${i + 1}. ${who}: ${m.content.slice(0, 200)}`;
      })
      .join("\n");
    const prompt = `A new message just arrived in a shared chat room. Below are the ${history.length} most recent prior messages (oldest first). Decide how many of the MOST RECENT of them are relevant context for understanding/answering the new message.

- If the new message starts a fresh, self-contained topic, answer 0.
- If it's a follow-up, include just enough recent messages (e.g. 3-5).
- Include more only if the new message clearly depends on a longer back-and-forth.

Prior messages:
${numbered}

New message: ${newMessage}

Answer with ONLY JSON: {"include": <integer 0-${history.length}>}`;
    const model = await getFastChatModel();
    const resp = await model.invoke([new HumanMessage(prompt)]);
    const text = typeof resp.content === "string" ? resp.content : "";
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return history.length;
    const n = Number(JSON.parse(match[0])?.include);
    if (!Number.isFinite(n)) return history.length;
    return Math.max(0, Math.min(history.length, Math.floor(n)));
  } catch (error) {
    console.error(
      "[Matrix] context-depth selection failed, using full history:",
      error,
    );
    return history.length;
  }
}

/**
 * Run one turn through the unified agent for a Matrix message and reply.
 * History is SHARED per room/thread and attributed by speaker. For the main
 * timeline a fast LLM trims history to the relevant recent messages; for a
 * thread the whole thread is sent (token-trimmed by the agent's context window).
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
  /** True when replying inside an existing thread (send the whole thread). */
  fullThreadHistory?: boolean;
}): Promise<void> {
  const {
    roomId,
    sender,
    displayName,
    messageText,
    useRag,
    webIntent,
    threadRootId,
    fullThreadHistory,
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

  let history = await loadConversationHistory(
    conversationId,
    fullThreadHistory ? THREAD_HISTORY_LIMIT : MAIN_HISTORY_LOOKBACK,
  );

  // Main timeline: trim to the relevant recent messages. Threads: keep the whole
  // thread (the agent's context window handles truncation if it gets long).
  if (!fullThreadHistory && history.length > 0) {
    const botName =
      matrixClient
        .getClient()
        ?.getRoom(roomId)
        ?.getMember(matrixClient.getClient()?.getUserId() || "")?.name ||
      "the assistant";
    const depth = await selectMainContextDepth(history, messageText, botName);
    history = history.slice(history.length - depth);
  }

  const result = await runAgent({
    messages: [
      ...history.map((m) => ({
        role: m.role,
        content: m.content,
        authorName: m.authorName,
      })),
      { role: "user" as const, content: messageText, authorName: displayName },
    ],
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
  // Already in a thread → reply in that thread.
  if (rel?.rel_type === "m.thread" && rel.event_id) {
    return rel.event_id;
  }
  // The event already has some OTHER relation (a reply, edit, or reaction).
  // Matrix rejects using such an event as a thread root ("Cannot start threads
  // from an event with a relation"), so reply on the main timeline instead.
  if (rel) {
    return undefined;
  }
  // Plain top-level message → start a new thread here if the room uses threads.
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
 * For a follow-up in a thread the bot is already part of, ask a fast LLM whether
 * the new message is actually directed at the bot (vs people talking to each
 * other). Defaults to replying if the check is unavailable/unclear, since the
 * user is in an active thread with the bot.
 */
async function shouldReplyInThread(
  threadConversationId: string,
  messageText: string,
  botName: string,
): Promise<boolean> {
  try {
    const history = await loadConversationHistory(threadConversationId, 12);
    const historyText = history
      .map((m) => `${m.role === "assistant" ? botName : "User"}: ${m.content}`)
      .join("\n")
      .slice(-4000);

    const prompt = `You are "${botName}", an AI assistant in a Matrix chat thread you have been participating in. Decide whether the NEW message is directed at you and expects a response from you, versus people talking to each other, thinking out loud, or an acknowledgement ("thanks!", "ok") that needs no reply.

Thread so far:
${historyText || "(no prior messages)"}

NEW message: ${messageText}

Answer with ONLY JSON: {"reply": true} or {"reply": false}`;

    const model = await getFastChatModel();
    const resp = await model.invoke([new HumanMessage(prompt)]);
    const text = typeof resp.content === "string" ? resp.content : "";
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return true;
    const obj = JSON.parse(match[0]);
    return obj?.reply !== false; // default to replying unless explicitly false
  } catch (error) {
    console.error(
      "[Matrix] shouldReplyInThread check failed, defaulting to reply:",
      error,
    );
    return true;
  }
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

    // Ignore message edits (m.replace) — otherwise editing a message would
    // trigger a second, duplicate response.
    const relatesTo = content?.["m.relates_to"];
    if (relatesTo?.rel_type === "m.replace" || content?.["m.new_content"]) {
      return;
    }

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

    // Mention-only rooms: ignore messages that don't mention the bot — UNLESS
    // the message is a follow-up in a thread the bot is already part of, in which
    // case a fast LLM decides whether the message is actually directed at the bot.
    if (room.mentionsOnly && !isBotMentioned(roomId, content, messageText)) {
      const incomingThreadRoot =
        relatesTo?.rel_type === "m.thread" ? relatesTo.event_id : null;
      const threadConvId = incomingThreadRoot
        ? await findMatrixThreadConversation(roomId, incomingThreadRoot)
        : null;

      if (!threadConvId) return; // not a bot thread and not mentioned → ignore

      const botName =
        client.getRoom(roomId)?.getMember(client.getUserId() || "")?.name ||
        "the assistant";
      const shouldReply = await shouldReplyInThread(
        threadConvId,
        messageText,
        botName,
      );
      if (!shouldReply) return; // in a bot thread, but not directed at the bot
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
        // In an existing thread → send the whole thread; on the main timeline →
        // let the depth selector trim to relevant recent messages.
        fullThreadHistory: relatesTo?.rel_type === "m.thread",
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
