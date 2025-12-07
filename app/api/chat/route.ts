import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { type NextRequest, NextResponse } from "next/server";
import { getChatModel, getFastChatModel } from "@/lib/ai";
import { readFileContent } from "@/lib/files";
import prisma from "@/lib/prisma";
import { search } from "@/lib/retrieval";
import { smartSearch } from "@/lib/smartRetrieval";
import {
  shouldRetrieveMore,
  retrieveAdditionalContext,
} from "@/lib/iterativeRetrieval";
import { getPrompts, interpolatePrompt } from "@/lib/prompts";
import {
  buildSearchQueryWithUserContext,
  buildUserContext,
  rephraseQuestionIfNeeded,
  updateConversationTopics,
} from "@/lib/contextBuilder";
import { manageContext } from "@/lib/contextWindow";
import { requireAuth } from "@/lib/session";
import { analyzeReferencedSources } from "@/lib/sourceAnalysis";
import { initializeApp } from "@/lib/init";
import { generateToolsForConfiguredPlugins } from "@/lib/toolGenerator";
import { shouldEnableIterativeRetrieval } from "@/lib/retrievalTools";
import { generateUtilityTools } from "@/lib/utilityTools";
import { routeQuery } from "@/lib/queryRouter";

export async function POST(req: NextRequest) {
  try {
    // Initialize plugins on first request
    initializeApp();

    // Require authentication
    const session = await requireAuth(req);

    const {
      messages,
      conversationId,
      sourceFilter,
      sourceCount = 35, // Default to max, smart retrieval will adjust down based on complexity
    } = await req.json();
    const lastMessage = messages[messages.length - 1];
    const query = lastMessage.content;

    // Get user profile from authenticated user
    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
      select: {
        userName: true,
        userBio: true,
        userPreferences: true,
      },
    });

    const userProfile = {
      userName: user?.userName || null,
      userBio: user?.userBio || null,
      userPreferences: user?.userPreferences
        ? JSON.parse(user.userPreferences)
        : null,
    };

    // Fetch prompts and context settings from database
    const [prompts, contextSettings] = await Promise.all([
      getPrompts(),
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

    // Route query to determine optimization strategy
    const queryRoute = routeQuery(query, isFirstMessage, messages.slice(0, -1));
    console.log(`[QueryRouter] ${queryRoute.reason}`);

    // Create or get conversation
    let convId = conversationId;
    if (!convId) {
      // Create new conversation with title from first message, associated with user
      const title = query.substring(0, 50) + (query.length > 50 ? "..." : "");
      const conversation = await prisma.conversation.create({
        data: {
          title,
          userId: session.user.id,
        },
      });
      convId = conversation.id;
    } else {
      // Verify user owns this conversation
      const conversation = await prisma.conversation.findUnique({
        where: { id: convId },
        select: { userId: true },
      });

      if (!conversation || conversation.userId !== session.user.id) {
        return NextResponse.json(
          { error: "Conversation not found or access denied" },
          { status: 403 },
        );
      }
    }

    // Save user message
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "user",
        content: query,
      },
    });

    // 1. Retrieve context (skip if sourceFilter is 'none' or if query is a counting/metadata query)
    let searchResults: any[] = [];
    let context = "";
    let searchQuery = query;
    let contextParts: string[] = []; // Declare outside for iterative retrieval access

    // Detect if this is a counting/metadata query that should skip RAG and use tools only
    const isCountingQuery = /\b(how many|count|total|number of)\b/i.test(query);
    const skipRagForTools = isCountingQuery && sourceFilter !== "none";

    if (sourceFilter !== "none" && !skipRagForTools) {
      // Enhance search query based on context
      if (isFirstMessage) {
        // First message: Add user context
        searchQuery = buildSearchQueryWithUserContext(
          query,
          userProfile.userName,
          userProfile.userBio,
        );
      } else if (!queryRoute.skipRephrasing) {
        // Follow-up message: Rephrase if needed (skip for fast path)
        const { rephrased, wasRephrased } = await rephraseQuestionIfNeeded(
          query,
          messages.slice(0, -1),
        );
        if (wasRephrased) {
          searchQuery = rephrased;
        }
      }

      // Use smart search if no specific filter is set, otherwise respect user's choice
      const clampedSourceCount = Math.max(1, Math.min(35, sourceCount));

      if (!sourceFilter || sourceFilter === "all") {
        // Fast path: use direct search, skip two-stage probe for simple queries
        if (queryRoute.path === "fast") {
          console.log("[QueryRouter] Fast path: using direct search");
          searchResults = await search(searchQuery, 10, "all"); // Smaller chunk count for fast queries
        } else {
          // Slow path: Smart search with two-stage analysis
          const smartResult = await smartSearch(
            searchQuery,
            undefined, // No user filter
            clampedSourceCount, // Max chunks
          );
          searchResults = smartResult.results;
        }
      } else {
        // Manual filter: respect user's source selection
        searchResults = await search(
          searchQuery,
          clampedSourceCount,
          sourceFilter,
        );
      }
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
    } else if (skipRagForTools) {
      // For counting queries, use a special prompt that emphasizes tool usage
      systemPrompt =
        `You are a helpful assistant with access to database query tools. ` +
        `The user has asked a counting or metadata query. You should use the appropriate tool to get accurate results from the database. ` +
        `Do not make up or estimate numbers - only use the exact counts returned by the tools.`;
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

    const { messages: managedMessages, summary } = await manageContext(
      messages.slice(0, -1), // Exclude current message (we'll add it separately)
      systemPrompt,
      maxTokens,
      strategy,
      windowSize,
    );

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

    // 4.5 Check if we should retrieve more context (iterative retrieval)
    // Fast path gets a lightweight check, slow path gets full iterative retrieval
    let additionalSources: any[] = [];
    const MAX_TOTAL_CHUNKS = 35; // Match smartRetrieval.ts maxChunks default
    let upgradedToSlowPath = false;

    // Fast path escape hatch: quick check if we got zero or very few results
    if (
      queryRoute.skipIterativeRetrieval &&
      searchResults.length > 0 &&
      searchResults.length < 3
    ) {
      console.log(
        `[QueryRouter] Fast path got only ${searchResults.length} results, checking if upgrade needed`,
      );
      try {
        const fastModel = await getFastChatModel();
        const escapeCheck = await fastModel.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(query),
          new HumanMessage(
            "Can you answer this question with the provided context? Reply with ONLY 'YES' or 'NO'.",
          ),
        ]);
        const canAnswer =
          typeof escapeCheck.content === "string"
            ? escapeCheck.content.trim().toUpperCase()
            : "";

        if (canAnswer.includes("NO")) {
          console.log("[QueryRouter] Fast path upgrading to slow path");
          upgradedToSlowPath = true;
          queryRoute.skipIterativeRetrieval = false;
          queryRoute.path = "slow";
        }
      } catch (error) {
        // Continue with fast path on error
        console.log(
          "[QueryRouter] Escape hatch check failed, continuing fast path",
        );
      }
    }

    if (
      !queryRoute.skipIterativeRetrieval &&
      searchResults.length > 0 &&
      searchResults.length < MAX_TOTAL_CHUNKS
    ) {
      // Only check if we have some results but not at max

      // Quick check with first ~200 chars of a fast preview
      const fastModel = await getFastChatModel();
      const previewMessages = [...langchainMessages];
      previewMessages.push(
        new HumanMessage(
          "Respond with ONLY 'NEED_MORE_CONTEXT' if you need additional document chunks to answer thoroughly, or 'SUFFICIENT' if you have enough information. Be conservative - only request more if truly necessary.",
        ),
      );

      try {
        const preview = await fastModel.invoke(previewMessages);
        const previewText =
          typeof preview.content === "string"
            ? preview.content.trim().toUpperCase()
            : "";

        if (previewText.includes("NEED_MORE")) {
          const analysis = await shouldRetrieveMore(
            query,
            previewText,
            searchResults.length,
            MAX_TOTAL_CHUNKS,
          );

          if (analysis.shouldRetrieve && analysis.suggestedCount) {
            const moreResults = await retrieveAdditionalContext(
              query,
              searchResults,
              sourceFilter === "all" || !sourceFilter ? "all" : sourceFilter,
              analysis.suggestedCount,
            );

            if (moreResults.length > 0) {
              // Add new chunks to context
              for (const result of moreResults) {
                const source = result.metadata.source || "synced";
                contextParts.push(
                  `Document: ${result.metadata.fileName}\nContent: ${result.content}`,
                );
                additionalSources.push({
                  fileName: result.metadata.fileName,
                  filePath: result.metadata.filePath,
                  chunk: result.content,
                  score: result.score,
                  source,
                });
              }

              // Update context and system prompt
              context = contextParts.join("\n\n");
              systemPrompt = interpolatePrompt(prompts.ragSystemPrompt, {
                context,
              });
              if (userContextString) {
                systemPrompt += `\n\n${userContextString}`;
              }

              // Update messages with new system prompt
              langchainMessages[0] = new SystemMessage(systemPrompt);
            }
          }
        }
      } catch (error) {
        // Continue with normal flow on error
      }
    }

    // 5. Set up tools and check for tool calls before streaming
    const chatModel = await getChatModel(); // Get model instance with current settings

    // Check if model supports tool calling and generate tools
    const modelName =
      (chatModel as any).modelName || (chatModel as any).model || "";
    const supportsTools = shouldEnableIterativeRetrieval(modelName);

    let tools: any[] = [];
    let toolResults: string[] = [];

    if (supportsTools) {
      try {
        // Get both plugin tools and utility tools
        const pluginTools = await generateToolsForConfiguredPlugins();
        const utilityTools = generateUtilityTools();
        tools = [...pluginTools, ...utilityTools];

        if (tools.length > 0) {
          // Add guidance about tool usage
          const toolGuidanceMessage = new SystemMessage(
            `You have access to tools that query databases directly for ACCURATE counts and metadata. ` +
              `When the user asks "how many" or wants to count items, you MUST use the appropriate search tool ` +
              `and TRUST THE TOOL'S COUNT RESULT - do NOT count from the context documents. ` +
              `The context documents are just a semantic search sample (limited to ~20 items). ` +
              `The tools query the FULL database and return the ACCURATE total count. ` +
              `ALWAYS report the count from the tool result, not from the context.`,
          );
          const messagesWithGuidance = [
            ...langchainMessages,
            toolGuidanceMessage,
          ];

          // First, check if LLM wants to use any tools
          const modelWithTools = chatModel.bindTools(tools);
          const toolCheckResponse =
            await modelWithTools.invoke(messagesWithGuidance);

          // Check if the response contains tool calls
          if (
            toolCheckResponse.tool_calls &&
            toolCheckResponse.tool_calls.length > 0
          ) {
            // Execute each tool call
            for (const toolCall of toolCheckResponse.tool_calls) {
              const tool = tools.find((t) => t.name === toolCall.name);
              if (tool) {
                try {
                  const result = await tool.func(toolCall.args);
                  toolResults.push(
                    `Tool '${toolCall.name}' returned:\n${result}`,
                  );
                } catch (error) {
                  toolResults.push(
                    `Tool '${toolCall.name}' failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                  );
                }
              }
            }

            // Add tool results to the context for final response
            if (toolResults.length > 0) {
              const toolResultsText = toolResults.join("\n\n");

              // Check if tool returned 0 results - if so, fall back to RAG search
              const toolReturnedZero =
                toolResultsText.includes("Count: 0") ||
                toolResultsText.includes("count: 0") ||
                toolResultsText.includes("0 matching results");

              if (toolReturnedZero && skipRagForTools) {
                // Perform RAG search now
                if (!sourceFilter || sourceFilter === "all") {
                  const smartResult = await smartSearch(query, undefined, 20);
                  searchResults = smartResult.results;
                } else {
                  searchResults = await search(query, 20, sourceFilter);
                }

                // Build context from search results
                for (const result of searchResults) {
                  contextParts.push(
                    `Document: ${result.metadata.fileName}\nContent: ${result.content}`,
                  );
                }
                context = contextParts.join("\n\n");

                // Update system prompt to include the RAG context
                systemPrompt = interpolatePrompt(prompts.ragSystemPrompt, {
                  context,
                });
                if (userContextString) {
                  systemPrompt += `\n\n${userContextString}`;
                }
                langchainMessages[0] = new SystemMessage(systemPrompt);

                // Add a note about the fallback
                langchainMessages.push(
                  new SystemMessage(
                    `The metadata query returned no results. However, here is relevant context from semantic search that might help answer the question.`,
                  ),
                );
              } else {
                langchainMessages.push(
                  new SystemMessage(
                    `Tool execution results:\n\n${toolResultsText}\n\nUse these results to answer the user's question.`,
                  ),
                );
              }
            }
          }
        }
      } catch (error) {
        // Error in tool calling flow, continue without tools
      }
    }

    // Now stream the final response (use fresh model without tools to avoid tool-calling in response)
    const parser = new StringOutputParser();
    const finalModel = await getChatModel(); // Fresh instance without tool binding
    const stream = await finalModel.pipe(parser).stream(langchainMessages);

    // Prepare sources data
    interface SourceData {
      fileName: string;
      filePath: string;
      chunk: string;
      score: number;
      source: string;
      relevanceScore?: number;
      isReferenced?: boolean;
    }

    const sourcesData: {
      type: string;
      sources: SourceData[];
    } = {
      type: "sources",
      sources: [
        ...searchResults.map((r) => ({
          fileName: r.metadata.fileName,
          filePath: r.metadata.filePath,
          chunk: r.content,
          score: r.score,
          source: r.metadata.source || "synced",
        })),
        ...additionalSources, // Add any sources from iterative retrieval
      ],
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
                const titleModel = await getFastChatModel(); // Use fast model for auxiliary task
                const titleResponse = await titleModel.invoke([
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

            // Analyze which sources were actually referenced
            let analyzedSources = sourcesData.sources;
            if (fullResponse && sourcesData.sources.length > 0) {
              try {
                analyzedSources = await analyzeReferencedSources(
                  fullResponse,
                  sourcesData.sources,
                );

                // Update the stored message with analyzed sources
                await prisma.message.update({
                  where: { id: assistantMessage.id },
                  data: { sources: JSON.stringify(analyzedSources) },
                });
              } catch (error) {
                console.error(
                  "[SourceAnalysis] Failed to analyze sources:",
                  error,
                );
                // Keep original sources if analysis fails
              }
            }

            // Send sources and conversation ID
            const finalData = {
              type: "sources",
              sources: analyzedSources,
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
    // Handle authentication errors
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
