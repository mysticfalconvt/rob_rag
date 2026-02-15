import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config as appConfig } from "../config";
import { indexFile } from "../indexer";

/**
 * Tool to save the assistant's last response as a note
 */
export const saveAssistantResponseTool = new DynamicStructuredTool({
  name: "save_assistant_response",
  description: `Save your last response as a searchable note in the RAG system.

IMPORTANT: When the user says "save that" or similar, call this tool IMMEDIATELY without asking for clarification.
The tool will automatically capture your previous response.

Use this when the user says:
- "Save that"
- "Save that as a note"
- "Remember this"
- "Create a note called X"
- "Save your summary/explanation/story"

The note will be saved as a markdown file and automatically indexed for future retrieval.`,
  schema: z.object({
    title: z.string().describe("Title for the note (required). Should be descriptive and concise."),
    tags: z.array(z.string()).optional().describe("Optional tags for categorizing the note (e.g., ['planning', 'ideas'])"),
  }),
  func: async ({ title, tags }, toolConfig) => {
    try {
      // Get the conversation history from config
      const conversationHistory = (toolConfig as any)?.configurable?.conversationHistory || [];
      const userId = (toolConfig as any)?.configurable?.userId;

      if (!conversationHistory || conversationHistory.length === 0) {
        return "❌ Cannot save note: No conversation history available.";
      }

      // Find the last assistant message
      let lastAssistantMessage = null;
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if (conversationHistory[i].role === "assistant") {
          lastAssistantMessage = conversationHistory[i].content;
          break;
        }
      }

      if (!lastAssistantMessage) {
        return "❌ Cannot save note: No assistant message found in conversation history.";
      }

      // Sanitize title for filename
      const sanitizedTitle = title
        .replace(/[^a-zA-Z0-9-_ ]/g, "")
        .replace(/\s+/g, "-")
        .substring(0, 100);

      const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const filename = `${sanitizedTitle}-${timestamp}.md`;

      // Create Notes directory if it doesn't exist
      const notesDir = path.join(appConfig.DOCUMENTS_FOLDER_PATH, "Notes");
      await mkdir(notesDir, { recursive: true });

      // Create markdown content with frontmatter
      const tagsList = tags && tags.length > 0 ? tags.join(", ") : "none";
      const markdownContent = `---
title: ${title}
date: ${new Date().toISOString()}
tags: ${tagsList}
source: user_note
---

# ${title}

${lastAssistantMessage}
`;

      // Write the file
      const filePath = path.join(notesDir, filename);
      await writeFile(filePath, markdownContent, "utf-8");

      // Index the file (this will create embeddings and add to vector DB)
      // Only pass userId if it's a valid UUID (not "system" for Matrix users)
      const validUserId = userId && userId !== "system" ? userId : undefined;
      await indexFile(filePath, validUserId);

      return `✅ **Note Saved Successfully!**

• **Title:** ${title}
• **Location:** Notes/${filename}
${tags && tags.length > 0 ? `• **Tags:** ${tags.join(", ")}\n` : ""}
The note has been indexed and is now searchable in your RAG system. You can find it in the /files page.`;
    } catch (error) {
      console.error("[NoteTool] Error saving note:", error);
      return `❌ Failed to save note: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});
