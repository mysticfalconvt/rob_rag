import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { type NextRequest, NextResponse } from "next/server";
import { chatModel } from "@/lib/ai";
import { readFileContent } from "@/lib/files";
import prisma from "@/lib/prisma";
import { search } from "@/lib/retrieval";
import { getPrompts, interpolatePrompt } from "@/lib/prompts";
import {
  getUserProfile,
  buildSearchQueryWithUserContext,
  buildUserContext,
  rephraseQuestionIfNeeded,
  updateConversationTopics,
} from "@/lib/contextBuilder";
import { manageContext } from "@/lib/contextWindow";

export async function POST(req: NextRequest) {
  try {
    const {
      messages,
      conversationId,
      sourceFilter,
      sourceCount = 5,
    } = await req.json();
    const lastMessage = messages[messages.length - 1];
    const query = lastMessage.content;

    // Fetch prompts, user profile, and context settings from database
    const [prompts, userProfile, contextSettings] = await Promise.all([
      getPrompts(),
      getUserProfile(),
      prisma.settings.findUnique({
        where: { id: "singleton" },
        select: {
          maxContextTokens: true,
          contextStrategy: true,
          slidingWindowSize: true,
          enableContextSummary: true,
        },
      }),
    ]);

    // Check if this is the first message
    const isFirstMessage = messages.length === 1;

    // Create or get conversation
    let convId = conversationId;
    if (!convId) {
      // Create new conversation with title from first message
      const title = query.substring(0, 50) + (query.length > 50 ? "..." : "");
      const conversation = await prisma.conversation.create({
        data: { title },
      });
      convId = conversation.id;
    }

    // Save user message
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "user",
        content: query,
      },
    });

    // 1. Retrieve context (skip if sourceFilter is 'none')
    let searchResults: any[] = [];
    let context = "";
    let searchQuery = query;

    if (sourceFilter !== "none") {
      // Enhance search query based on context
      if (isFirstMessage) {
        // First message: Add user context
        searchQuery = buildSearchQueryWithUserContext(
          query,
          userProfile.userName,
          userProfile.userBio,
        );
        console.log("[Context] First message - adding user context to search");
      } else {
        // Follow-up message: Rephrase if needed
        const { rephrased, wasRephrased } = await rephraseQuestionIfNeeded(
          query,
          messages.slice(0, -1),
        );
        if (wasRephrased) {
          searchQuery = rephrased;
          console.log("[Context] Rephrased question for better search");
        }
      }

      // Clamp sourceCount between 1 and 20
      const clampedSourceCount = Math.max(1, Math.min(20, sourceCount));
      const filterDisplay = Array.isArray(sourceFilter)
        ? sourceFilter.join(", ")
        : sourceFilter || "all";
      console.log(
        "Searching for:",
        searchQuery,
        "with filter:",
        filterDisplay,
        "count:",
        clampedSourceCount,
      );
      searchResults = await search(
        searchQuery,
        clampedSourceCount,
        sourceFilter,
      );
      console.log("Found", searchResults.length, "results");
      // console.log('Search result scores:', searchResults.map(r => ({ file: r.metadata.fileName, score: r.score })));

      // Context Optimization: Group by file and check if we should load full content
      const groupedResults: Record<string, typeof searchResults> = {};
      searchResults.forEach((r) => {
        const path = r.metadata.filePath;
        if (path) {
          if (!groupedResults[path]) groupedResults[path] = [];
          groupedResults[path].push(r);
        }
      });

      const contextParts: string[] = [];
      const processedFiles = new Set<string>();

      for (const result of searchResults) {
        const filePath = result.metadata.filePath;
        if (!filePath || processedFiles.has(filePath)) continue;

        const fileResults = groupedResults[filePath];
        const totalChunks = result.metadata.totalChunks || 100; // Default to high if missing
        const source = result.metadata.source;

        // For Goodreads books and Paperless docs, always use chunk content (no file to read)
        const isVirtualSource =
          source === "goodreads" || source === "paperless";

        // Heuristic: Load full file if:
        // 1. File is small (<= 5 chunks)
        // 2. We have a significant portion of the file (> 30% of chunks)
        // 3. NOT a virtual source (Goodreads/Paperless)
        const isSmallFile = totalChunks <= 5;
        const hasSignificantPortion = fileResults.length / totalChunks > 0.3;

        if (!isVirtualSource && (isSmallFile || hasSignificantPortion)) {
          try {
            console.log(
              `Loading full content for ${result.metadata.fileName} (Chunks: ${totalChunks}, Found: ${fileResults.length})`,
            );
            const { content: fullContent } = await readFileContent(filePath);
            contextParts.push(
              `Document: ${result.metadata.fileName}\n(Full Content)\n${fullContent}`,
            );
            processedFiles.add(filePath);
          } catch (e) {
            console.error(
              `Failed to read full file ${filePath}, falling back to chunks`,
              e,
            );
            // Fallback to adding just this chunk (and others will be added as we iterate)
            contextParts.push(
              `Document: ${result.metadata.fileName}\nContent: ${result.content}`,
            );
          }
        } else {
          // Add just this chunk (for virtual sources or when we don't want full content)
          contextParts.push(
            `Document: ${result.metadata.fileName}\nContent: ${result.content}`,
          );
        }
      }

      context = contextParts.join("\n\n");
    } else {
      console.log("No sources mode - chatting without document context");
    }

    // 2. Build system prompt using customizable prompts
    let systemPrompt: string;
    const userContextString = buildUserContext(
      userProfile.userName,
      userProfile.userBio,
    );

    if (sourceFilter === "none") {
      systemPrompt = prompts.noSourcesSystemPrompt;
      if (userContextString) {
        systemPrompt += `\n\n${userContextString}`;
      }
    } else {
      systemPrompt = interpolatePrompt(prompts.ragSystemPrompt, { context });
      if (userContextString) {
        systemPrompt += `\n\n${userContextString}`;
      }
    }

    // 3. Apply context window management to prevent token overflow
    const maxTokens = contextSettings?.maxContextTokens ?? 8000;
    const strategy = (contextSettings?.contextStrategy ?? "smart") as
      | "sliding"
      | "token"
      | "smart";
    const windowSize = contextSettings?.slidingWindowSize ?? 10;

    const {
      messages: managedMessages,
      summary,
      truncated,
    } = await manageContext(
      messages.slice(0, -1), // Exclude current message (we'll add it separately)
      systemPrompt,
      maxTokens,
      strategy,
      windowSize,
    );

    if (truncated) {
      console.log("[Context] Applied context management due to length");
    }

    // 4. Prepare messages for LangChain
    const langchainMessages: (SystemMessage | HumanMessage | AIMessage)[] = [
      new SystemMessage(systemPrompt),
    ];

    // Add summary if we have one
    if (summary) {
      langchainMessages.push(
        new SystemMessage(`Previous conversation summary:\n${summary}`),
      );
    }

    // Add managed conversation history
    langchainMessages.push(
      ...managedMessages.map((m: any) =>
        m.role === "user"
          ? new HumanMessage(m.content)
          : new AIMessage(m.content),
      ),
    );

    // Add current query
    langchainMessages.push(new HumanMessage(query));

    // 5. Stream response
    console.log("Calling LM Studio...");
    const parser = new StringOutputParser();
    const stream = await chatModel.pipe(parser).stream(langchainMessages);

    // Prepare sources data
    const sourcesData = {
      type: "sources",
      sources: searchResults.map((r) => ({
        fileName: r.metadata.fileName,
        filePath: r.metadata.filePath,
        chunk: r.content,
        score: r.score,
        source: r.metadata.source || "synced",
      })),
    };

    // Create assistant message record early so it's saved even if client disconnects
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: convId,
        role: "assistant",
        content: "", // Will be updated as content streams
        sources: JSON.stringify(sourcesData.sources),
      },
    });

    // Collect response for saving
    let fullResponse = "";
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL_MS = 2000; // Save every 2 seconds
    const MIN_CHARS_FOR_SAVE = 50; // Also save after accumulating 50 chars

    // Helper function to save message incrementally
    const saveMessage = async (content: string) => {
      try {
        await prisma.message.update({
          where: { id: assistantMessage.id },
          data: { content },
        });
        await prisma.conversation.update({
          where: { id: convId },
          data: { updatedAt: new Date() },
        });
      } catch (error) {
        console.error("Error saving message incrementally:", error);
      }
    };

    // Convert string stream to byte stream for NextResponse
    const iterator = stream[Symbol.asyncIterator]();
    const byteStream = new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await iterator.next();
          if (done) {
            // Final save with complete content
            await saveMessage(fullResponse);

            // Generate title if this is the first message
            if (messages.length === 1) {
              try {
                const titlePrompt = interpolatePrompt(
                  prompts.titleGenerationPrompt,
                  {
                    userMessage: query,
                    assistantMessage: fullResponse,
                  },
                );
                const titleResponse = await chatModel.invoke([
                  new HumanMessage(titlePrompt),
                ]);
                const newTitle =
                  typeof titleResponse.content === "string"
                    ? titleResponse.content.replace(/^["']|["']$/g, "").trim()
                    : "";

                if (newTitle) {
                  await prisma.conversation.update({
                    where: { id: convId },
                    data: { title: newTitle },
                  });
                }
              } catch (error) {
                console.error("Failed to generate title:", error);
              }
            }

            // Update conversation topics (async, don't wait)
            updateConversationTopics(convId, fullResponse).catch((err) =>
              console.error("Failed to update topics:", err),
            );

            // Send sources and conversation ID
            const finalData = {
              ...sourcesData,
              conversationId: convId,
            };
            controller.enqueue(
              new TextEncoder().encode(
                `\n__SOURCES__:${JSON.stringify(finalData)}`,
              ),
            );
            controller.close();
          } else {
            fullResponse += value;
            controller.enqueue(new TextEncoder().encode(value));

            // Save incrementally: either after time interval or after accumulating enough chars
            const now = Date.now();
            const shouldSave =
              now - lastSaveTime >= SAVE_INTERVAL_MS ||
              (fullResponse.length >= MIN_CHARS_FOR_SAVE &&
                fullResponse.length % MIN_CHARS_FOR_SAVE < value.length);

            if (shouldSave) {
              lastSaveTime = now;
              // Don't await to avoid blocking the stream
              saveMessage(fullResponse).catch((err) =>
                console.error("Background save error:", err),
              );
            }
          }
        } catch (error) {
          console.error("Stream error:", error);
          // Ensure message is saved even on error
          if (fullResponse) {
            saveMessage(fullResponse).catch((err) =>
              console.error("Error saving on stream error:", err),
            );
          }
          controller.error(error);
        }
      },
      cancel() {
        // Client disconnected - save what we have so far
        if (fullResponse) {
          saveMessage(fullResponse).catch((err) =>
            console.error("Error saving on cancel:", err),
          );
        }
      },
    });

    return new NextResponse(byteStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
