import { MatrixEvent, Room, RoomEvent } from "matrix-js-sdk";
import { matrixClient } from "./client";
import prisma from "../prisma";
import { sendFormattedMessage } from "./sender";

/**
 * Rate limiting per room
 */
const roomRateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // Max 10 messages per minute per room

/**
 * Conversation history per room
 * Stores messages with timestamps for context management
 */
interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const roomConversations = new Map<string, ConversationMessage[]>();
const CONTEXT_WINDOW = 30 * 60 * 1000; // 30 minutes in milliseconds

/**
 * Check if a room is rate limited
 */
function isRateLimited(roomId: string): boolean {
  const now = Date.now();
  const limit = roomRateLimits.get(roomId);

  if (!limit || now > limit.resetTime) {
    // Reset or create new limit
    roomRateLimits.set(roomId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return false;
  }

  if (limit.count >= RATE_LIMIT_MAX) {
    return true;
  }

  limit.count++;
  return false;
}

/**
 * Process an incoming Matrix message
 */
async function handleMessage(event: MatrixEvent): Promise<void> {
  try {
    const client = matrixClient.getClient();
    if (!client) {
      return;
    }

    const roomId = event.getRoomId();
    const sender = event.getSender();
    const content = event.getContent();
    const messageText = content.body;

    if (!roomId || !sender || !messageText) {
      return;
    }

    // Ignore messages from ourselves
    if (sender === client.getUserId()) {
      return;
    }

    console.log(`[Matrix] Received message in ${roomId} from ${sender}: ${messageText.substring(0, 100)}`);

    // Check for #clear command first
    if (messageText.trim().toLowerCase() === "#clear") {
      roomConversations.delete(roomId);
      console.log(`[Matrix] Context cleared for room ${roomId}`);
      await sendFormattedMessage(roomId, "✅ Context cleared. Starting fresh conversation.");
      return;
    }

    // Check if room is enabled
    const room = await prisma.matrixRoom.findUnique({
      where: { roomId },
    });

    if (!room) {
      console.log(`[Matrix] Room ${roomId} not in database, skipping`);
      return;
    }

    if (!room.enabled) {
      console.log(`[Matrix] Room ${roomId} is disabled, skipping`);
      return;
    }

    // Check rate limiting
    if (isRateLimited(roomId)) {
      console.log(`[Matrix] Room ${roomId} is rate limited, skipping`);
      await sendFormattedMessage(
        roomId,
        "⚠️ Rate limit exceeded. Please wait a moment before sending more messages.",
      );
      return;
    }

    // Send typing indicator and keep it alive
    await matrixClient.sendTyping(roomId, true);

    // Set up interval to renew typing indicator every 10 seconds
    const typingInterval = setInterval(async () => {
      try {
        await matrixClient.sendTyping(roomId, true);
      } catch (error) {
        console.error("[Matrix] Error sending typing indicator:", error);
      }
    }, 10000); // Renew every 10 seconds

    try {
      // Get user display name for better context
      const displayName = await getMatrixUserDisplayName(roomId, sender);
      console.log(`[Matrix] Processing message from ${displayName} (${sender})`);

      // Add user message to conversation history
      const userMessage: ConversationMessage = {
        role: "user",
        content: messageText,
        timestamp: Date.now(),
      };

      // Get existing conversation history
      const history = roomConversations.get(roomId) || [];
      history.push(userMessage);
      roomConversations.set(roomId, history);

      // Call the RAG flow with conversation context
      const response = await callRagFlow(messageText, roomId, sender, displayName);

      // Add assistant response to conversation history
      const assistantMessage: ConversationMessage = {
        role: "assistant",
        content: response.text,
        timestamp: Date.now(),
      };
      history.push(assistantMessage);
      roomConversations.set(roomId, history);

      // Send the response
      await sendFormattedMessage(roomId, response.text, response.sources);
    } catch (error) {
      console.error("[Matrix] Error processing message:", error);
      await sendFormattedMessage(
        roomId,
        "❌ Sorry, I encountered an error processing your message. Please try again later.",
      );
    } finally {
      // Stop typing indicator and clear interval
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
async function getMatrixUserDisplayName(roomId: string, userId: string): Promise<string> {
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
 * Get pruned conversation history for a room
 * Removes messages older than 30 minutes but always includes the latest message
 */
function getPrunedHistory(roomId: string, currentMessage: string): Array<{ role: string; content: string }> {
  const history = roomConversations.get(roomId) || [];
  const now = Date.now();
  const cutoffTime = now - CONTEXT_WINDOW;

  // Prune messages older than 30 minutes
  const prunedHistory = history.filter(msg => msg.timestamp > cutoffTime);

  // Convert to chat API format
  const messages = prunedHistory.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  // Always include the current message (it's already added to history before this call)
  // The last message in history is the current user message, so it's already included

  console.log(`[Matrix] Context for room ${roomId}: ${messages.length} messages (pruned ${history.length - prunedHistory.length} old messages)`);

  return messages;
}

/**
 * Call the RAG flow via internal API
 */
async function callRagFlow(
  query: string,
  roomId: string,
  sender: string,
  displayName: string,
): Promise<{ text: string; sources?: any[] }> {
  try {
    const internalServiceKey = process.env.INTERNAL_SERVICE_KEY;
    if (!internalServiceKey) {
      throw new Error("INTERNAL_SERVICE_KEY not configured");
    }

    // Get conversation history with 30-minute pruning
    const messages = getPrunedHistory(roomId, query);

    // Call the chat API internally
    const response = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        triggerSource: "matrix",
        matrixRoomId: roomId,
        matrixSender: sender,
        matrixDisplayName: displayName,
        internalServiceKey,
      }),
    });

    if (!response.ok) {
      throw new Error(`RAG flow returned ${response.status}`);
    }

    // Read the streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    let fullResponse = "";
    let sources: any[] = [];

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Check for sources marker
      if (chunk.includes("__SOURCES__:")) {
        const parts = chunk.split("__SOURCES__:");
        fullResponse += parts[0];

        if (parts[1]) {
          try {
            const sourcesData = JSON.parse(parts[1]);
            sources = sourcesData.sources || [];
          } catch (e) {
            console.error("[Matrix] Failed to parse sources:", e);
          }
        }
      } else {
        fullResponse += chunk;
      }
    }

    return {
      text: fullResponse.trim(),
      sources,
    };
  } catch (error) {
    console.error("[Matrix] Error calling RAG flow:", error);
    throw error;
  }
}

let handlerInitialized = false;

/**
 * Initialize message handler
 * This should be called after the Matrix client is ready
 */
export function initializeMessageHandler(): void {
  if (handlerInitialized) {
    console.log("[Matrix] Message handler already initialized, skipping");
    return;
  }

  const client = matrixClient.getClient();
  if (!client) {
    console.error("[Matrix] Cannot initialize message handler: client not ready");
    return;
  }

  console.log("[Matrix] Initializing message handler...");

  // Listen for timeline events (new messages)
  client.on(RoomEvent.Timeline as any, async (event: MatrixEvent, room: Room | undefined) => {
    // Only process message events
    if (event.getType() !== "m.room.message") {
      return;
    }

    // Only process text messages
    const content = event.getContent();
    if (content.msgtype !== "m.text") {
      return;
    }

    // Handle the message
    await handleMessage(event);
  });

  handlerInitialized = true;
  console.log("[Matrix] Message handler initialized");
}
