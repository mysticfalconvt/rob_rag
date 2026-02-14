import { matrixClient } from "./client";

/**
 * Maximum message length before splitting (Matrix typically allows ~64KB, but we'll be conservative)
 */
const MAX_MESSAGE_LENGTH = 10000;

/**
 * Format sources for display in Matrix
 */
function formatSources(sources: any[]): string {
  if (!sources || sources.length === 0) {
    return "";
  }

  const uniqueSources = new Map<string, any>();

  // Deduplicate by fileName
  for (const source of sources) {
    if (!uniqueSources.has(source.fileName)) {
      uniqueSources.set(source.fileName, source);
    }
  }

  const sourceList = Array.from(uniqueSources.values())
    .slice(0, 10) // Limit to 10 sources
    .map((source, index) => {
      let line = `${index + 1}. **${source.fileName}**`;

      // Add source type if available
      if (source.source) {
        line += ` (${source.source})`;
      }

      // Add score if available and significant
      if (source.score && source.score > 0) {
        line += ` - relevance: ${(source.score * 100).toFixed(0)}%`;
      }

      return line;
    })
    .join("\n");

  return `\n\n**Sources:**\n${sourceList}`;
}

/**
 * Split a long message into chunks
 */
function splitMessage(message: string, maxLength: number): string[] {
  if (message.length <= maxLength) {
    return [message];
  }

  const chunks: string[] = [];
  let currentChunk = "";

  // Split by paragraphs first
  const paragraphs = message.split("\n\n");

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 > maxLength) {
      // Current chunk would be too long, save it and start a new one
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }

      // If a single paragraph is too long, split it by sentences
      if (paragraph.length > maxLength) {
        const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
          } else {
            currentChunk += sentence;
          }
        }
      } else {
        currentChunk = paragraph;
      }
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Send a formatted message to a Matrix room
 * Supports markdown formatting and automatic message splitting
 */
export async function sendFormattedMessage(
  roomId: string,
  message: string,
  sources?: any[],
): Promise<void> {
  try {
    const client = matrixClient.getClient();
    if (!client) {
      throw new Error("Matrix client not available");
    }

    // Add sources if provided
    let fullMessage = message;
    if (sources && sources.length > 0) {
      fullMessage += formatSources(sources);
    }

    // Split message if too long
    const chunks = splitMessage(fullMessage, MAX_MESSAGE_LENGTH);

    // Send each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const prefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}] ` : "";

      await client.sendMessage(roomId, {
        msgtype: "m.text" as any,
        body: prefix + chunk,
        format: "org.matrix.custom.html",
        formatted_body: prefix + convertMarkdownToHtml(chunk),
      });

      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    console.log(`[Matrix] Sent ${chunks.length} message(s) to room ${roomId}`);
  } catch (error) {
    // Check if it's an encryption error
    if (error instanceof Error && error.message.includes("encryption")) {
      const friendlyError = new Error(
        "This room uses encryption which is not currently supported. Please use an unencrypted room or disable encryption for this room."
      );
      console.error("[Matrix] Encryption not supported:", error);
      throw friendlyError;
    }
    console.error("[Matrix] Failed to send formatted message:", error);
    throw error;
  }
}

/**
 * Simple markdown to HTML converter
 * Supports: bold, italic, code, code blocks, links
 */
function convertMarkdownToHtml(markdown: string): string {
  let html = markdown;

  // Code blocks (must be done before inline code)
  html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Paragraphs
  html = html.replace(/\n\n/g, "<br><br>");
  html = html.replace(/\n/g, "<br>");

  return html;
}

/**
 * Send a simple text message (no formatting)
 */
export async function sendTextMessage(roomId: string, message: string): Promise<void> {
  const client = matrixClient.getClient();
  if (!client) {
    throw new Error("Matrix client not available");
  }

  await client.sendTextMessage(roomId, message);
  console.log(`[Matrix] Sent text message to room ${roomId}`);
}

/**
 * Send an error message with standard formatting
 */
export async function sendErrorMessage(roomId: string, error: string): Promise<void> {
  await sendFormattedMessage(roomId, `❌ **Error:** ${error}`);
}

/**
 * Send a success message with standard formatting
 */
export async function sendSuccessMessage(roomId: string, message: string): Promise<void> {
  await sendFormattedMessage(roomId, `✅ ${message}`);
}
