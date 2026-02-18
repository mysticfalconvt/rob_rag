import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { type NextRequest, NextResponse } from "next/server";
import { getChatModel, getFastChatModel, trackChatInvoke, estimateMessageTokens } from "@/lib/ai";
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
import { initializeApp, initializeMatrix } from "@/lib/init";
import { generateToolsForConfiguredPlugins } from "@/lib/toolGenerator";
import { shouldEnableIterativeRetrieval } from "@/lib/retrievalTools";
import { generateUtilityTools } from "@/lib/utilityTools";
import { routeQuery } from "@/lib/queryRouter";
import { LLMRequestTracker } from "@/lib/llmTracking";
import { routeToolSelection, filterToolsByRouting, explainToolSelection } from "@/lib/toolRouter";
import { searchWeb, searchDeep, formatWebResultsAsContext, isWebSearchConfigured } from "@/lib/webSearch";

export async function POST(req: NextRequest) {
  try {
    // Initialize app and Matrix on first request
    initializeApp();
    initializeMatrix();

    const body = await req.json();
    const {
      messages,
      conversationId,
      sourceFilter,
      sourceCount = 35, // Default to max, smart retrieval will adjust down based on complexity
      documentPath, // Optional: chat in context of this single document only
      triggerSource, // 'user', 'matrix', 'scheduled'
      internalServiceKey,
      matrixRoomId,
      matrixSender,
      matrixDisplayName,
      webSearchQuery,
      webResearchQuery,
      webSearchEnabled,
    } = body;

    // Check for internal service authentication (Matrix/Scheduler)
    let userId: string;
    let userProfile: { userName: string | null; userBio: string | null; userPreferences: any };

    if (triggerSource === "matrix" || triggerSource === "scheduled") {
      // Internal request - validate service key
      const expectedKey = process.env.INTERNAL_SERVICE_KEY;
      if (!expectedKey || internalServiceKey !== expectedKey) {
        console.error("[Chat API] Invalid internal service key");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Check if Matrix sender is in allowed users list
      let useAdminProfile = false;
      if (triggerSource === "matrix" && matrixSender) {
        const settings = await prisma.settings.findUnique({
          where: { id: "singleton" },
          select: { matrixAllowedUsers: true },
        });

        if (settings?.matrixAllowedUsers) {
          try {
            const allowedUsers = JSON.parse(settings.matrixAllowedUsers);
            useAdminProfile = allowedUsers.includes(matrixSender);
          } catch (e) {
            console.error("[Chat API] Failed to parse matrixAllowedUsers:", e);
          }
        }
      }

      if (useAdminProfile || triggerSource === "scheduled") {
        // Use admin's RobRAG profile for allowed users or scheduled tasks
        const adminUser = await prisma.authUser.findFirst({
          where: { role: "admin" },
          select: {
            id: true,
            userName: true,
            userBio: true,
            userPreferences: true,
          },
        });

        if (adminUser) {
          userId = adminUser.id;
          userProfile = {
            userName: adminUser.userName || null,
            userBio: adminUser.userBio || null,
            userPreferences: adminUser.userPreferences
              ? JSON.parse(adminUser.userPreferences)
              : null,
          };
          console.log(`[Chat API] Internal request from ${triggerSource} using admin profile: ${userProfile.userName || 'admin'}`);
        } else {
          // Fallback if no admin found
          userId = "system";
          userProfile = {
            userName: null,
            userBio: null,
            userPreferences: null,
          };
          console.log(`[Chat API] Internal request from ${triggerSource} using system profile (no admin found)`);
        }
      } else {
        // Not in allowed list - use Matrix display name as generic profile
        userId = "system";
        userProfile = {
          userName: matrixDisplayName || "Matrix User",
          userBio: matrixSender ? `Matrix ID: ${matrixSender}` : null,
          userPreferences: null,
        };
        console.log(`[Chat API] Internal request from ${triggerSource} using Matrix profile: ${userProfile.userName} (not in allowed list)`);
      }
    } else {
      // Regular user request - require authentication
      const session = await requireAuth(req);
      userId = session.user.id;

      // Get user profile from authenticated user
      const user = await prisma.authUser.findUnique({
        where: { id: userId },
        select: {
          userName: true,
          userBio: true,
          userPreferences: true,
        },
      });

      userProfile = {
        userName: user?.userName || null,
        userBio: user?.userBio || null,
        userPreferences: user?.userPreferences
          ? JSON.parse(user.userPreferences)
          : null,
      };
    }

    const lastMessage = messages[messages.length - 1];
    const query = lastMessage.content;

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

    // Create or get conversation (skip for internal requests without conversationId)
    let convId = conversationId;

    if (triggerSource === "matrix" || triggerSource === "scheduled") {
      // Internal requests don't need conversation tracking
      convId = null;
    } else if (!convId) {
      // Create new conversation with title from first message, associated with user
      const title = query.substring(0, 50) + (query.length > 50 ? "..." : "");
      const conversation = await prisma.conversation.create({
        data: {
          title,
          userId,
        },
      });
      convId = conversation.id;
    } else {
      // Verify user owns this conversation
      const conversation = await prisma.conversation.findUnique({
        where: { id: convId },
        select: { userId: true },
      });

      if (!conversation || conversation.userId !== userId) {
        return NextResponse.json(
          { error: "Conversation not found or access denied" },
          { status: 403 },
        );
      }
    }

    // Save user message (only if we have a conversation)
    let userMessage: any = null;
    if (convId) {
      userMessage = await prisma.message.create({
        data: {
          conversationId: convId,
          role: "user",
          content: query,
        },
      });
    }

    // Initialize LLM request tracker
    const llmTracker = new LLMRequestTracker({
      conversationId: convId || undefined,
      messageId: userMessage?.id,
      userId,
      requestType: triggerSource === "matrix" ? "matrix_chat" : triggerSource === "scheduled" ? "scheduled_task" : "user_chat",
      requestPayload: JSON.stringify({
        query: query.substring(0, 200),
        sourceFilter,
        sourceCount,
        isFirstMessage: messages.length === 1,
        triggerSource,
        matrixRoomId,
      }),
    });

    // 1. Retrieve context (skip if sourceFilter is 'none' or if query is a counting/metadata query)
    let searchResults: any[] = [];
    let context = "";
    let searchQuery = query;
    let contextParts: string[] = []; // Declare outside for iterative retrieval access

    // Detect if this is a counting/metadata/tool-only query that should skip RAG
    const isCountingQuery = /\b(how many|count|total|number of)\b/i.test(query);
    const isReminderQuery = /\b(remind me|reminder|set a reminder|schedule|create reminder)\b/i.test(query);
    const isListQuery = /\b(list (my )?reminders?|show (my )?reminders?|what reminders)\b/i.test(query);
    const skipRagForTools = (isCountingQuery || isReminderQuery || isListQuery) && sourceFilter !== "none";

    // Single-document chat: use only this doc as context (full content or chunked vector search)
    const singleDocPath =
      typeof documentPath === "string" ? documentPath.trim() : null;
    if (singleDocPath) {
      const fileRecord = await prisma.indexedFile.findUnique({
        where: { filePath: singleDocPath },
        select: { chunkCount: true, source: true, paperlessTitle: true },
      });

      if (fileRecord) {
        const docDisplayName =
          fileRecord.paperlessTitle ??
          singleDocPath.split("/").filter(Boolean).pop() ??
          "document";
        const isVirtualSource =
          fileRecord.source === "goodreads" ||
          fileRecord.source === "paperless" ||
          fileRecord.source === "google-calendar";
        const fullContentMaxChars = 12000; // ~3k tokens
        const fullContentMaxChunks = 20;

        if (
          !isVirtualSource &&
          fileRecord.chunkCount <= fullContentMaxChunks
        ) {
          try {
            const { content: fullContent } = await readFileContent(singleDocPath);
            if (fullContent.length <= fullContentMaxChars) {
              context = `Document: ${docDisplayName}\n(Full content - single document chat)\n${fullContent}`;
              console.log(
                "[Chat] Single-doc mode: using full document content",
                singleDocPath,
              );
            } else {
              // Too long: use vector search for this doc only
              searchResults = await search(
                searchQuery,
                25,
                undefined,
                (m) => llmTracker.trackCall("embedding", { ...m, callPayload: "single_doc_search" }),
                singleDocPath,
              );
            }
          } catch (e) {
            console.warn(
              "[Chat] Single-doc full content failed, falling back to chunk search:",
              e,
            );
            searchResults = await search(
              searchQuery,
              25,
              undefined,
              (m) => llmTracker.trackCall("embedding", { ...m, callPayload: "single_doc_search" }),
              singleDocPath,
            );
          }
        } else {
          // Virtual source or many chunks: use vector search restricted to this doc
          searchResults = await search(
            searchQuery,
            25,
            undefined,
            (m) => llmTracker.trackCall("embedding", { ...m, callPayload: "single_doc_search" }),
            singleDocPath,
          );
        }

        if (searchResults.length > 0 && !context) {
          const processedFiles = new Set<string>();
          for (const result of searchResults) {
            const filePath = result.metadata.filePath;
            if (!filePath || processedFiles.has(filePath)) continue;
            processedFiles.add(filePath);
            contextParts.push(
              `Document: ${result.metadata.fileName}\nContent: ${result.content}`,
            );
          }
          context = contextParts.join("\n\n");
        }
      } else {
        console.warn("[Chat] Single-doc path not found in index:", singleDocPath);
      }
    }

    if (
      !singleDocPath &&
      sourceFilter !== "none" &&
      !skipRagForTools
    ) {
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
          searchResults = await search(
            searchQuery,
            10,
            "all",
            (metrics) => llmTracker.trackCall("embedding", {
              ...metrics,
              callPayload: JSON.stringify({
                type: "fast_path_search",
                queryLength: searchQuery.length,
                limit: 10,
                sourceFilter: "all",
                request: searchQuery,
                response: "embedding_vector"
              })
            })
          ); // Smaller chunk count for fast queries
        } else {
          // Slow path: Smart search with two-stage analysis
          const smartResult = await smartSearch(
            searchQuery,
            undefined, // No user filter
            clampedSourceCount, // Max chunks
            (metrics) => llmTracker.trackCall("embedding", {
              ...metrics,
              callPayload: JSON.stringify({
                type: "smart_search",
                queryLength: searchQuery.length,
                maxChunks: clampedSourceCount,
                request: searchQuery,
                response: "embedding_vector"
              })
            })
          );
          searchResults = smartResult.results;
        }
      } else {
        // Manual filter: respect user's source selection
        searchResults = await search(
          searchQuery,
          clampedSourceCount,
          sourceFilter,
          (metrics) => llmTracker.trackCall("embedding", {
            ...metrics,
            callPayload: JSON.stringify({
              type: "manual_filter_search",
              queryLength: searchQuery.length,
              limit: clampedSourceCount,
              sourceFilter: Array.isArray(sourceFilter) ? sourceFilter.join(',') : sourceFilter,
              request: searchQuery,
              response: "embedding_vector"
            })
          })
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

        // For Goodreads books, Paperless docs, and Google Calendar events, always use chunk content (no file to read)
        const isVirtualSource =
          source === "goodreads" || source === "paperless" || source === "google-calendar";

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

    // 1.5 Handle web search / research commands and toggle
    let webSources: any[] = [];

    if (webSearchQuery) {
      // Explicit #search command - replace RAG context with web results
      console.log(`[WebSearch] Explicit web search: "${webSearchQuery.substring(0, 50)}"`);
      const webResponse = await searchWeb(webSearchQuery);
      const webContext = formatWebResultsAsContext(webResponse);
      context = webContext;
      contextParts = [webContext];
      webSources = webResponse.results.map((r) => ({
        fileName: r.title,
        filePath: r.url,
        chunk: r.snippet,
        score: r.score || 0,
        source: "web_search",
      }));
      searchResults = []; // Clear RAG results
    } else if (webResearchQuery) {
      // Explicit #research command - replace RAG context with Perplexica results
      console.log(`[WebSearch] Explicit deep research: "${webResearchQuery.substring(0, 50)}"`);
      const webResponse = await searchDeep(webResearchQuery);
      const webContext = formatWebResultsAsContext(webResponse);
      context = webContext;
      contextParts = [webContext];
      webSources = webResponse.results.map((r) => ({
        fileName: r.title,
        filePath: r.url,
        chunk: r.snippet,
        score: r.score || 0,
        source: "web_research",
      }));
      searchResults = []; // Clear RAG results
    } else if (webSearchEnabled && isWebSearchConfigured()) {
      // UI toggle - merge web results with RAG context
      console.log(`[WebSearch] Web search toggle enabled, supplementing RAG context`);
      const webResponse = await searchWeb(query);
      if (webResponse.results.length > 0) {
        const webContext = formatWebResultsAsContext(webResponse);
        contextParts.push("\n--- Web Search Results ---\n" + webContext);
        context = contextParts.join("\n\n");
        webSources = webResponse.results.map((r) => ({
          fileName: r.title,
          filePath: r.url,
          chunk: r.snippet,
          score: r.score || 0,
          source: "web_search",
        }));
      }
    }

    // 2. Build system prompt using customizable prompts
    let systemPrompt: string;
    const userContextString = buildUserContext(
      userProfile.userName,
      userProfile.userBio,
    );

    // Add Matrix-specific formatting instructions
    const matrixFormattingNote = (triggerSource === "matrix" || triggerSource === "scheduled")
      ? `\n\nIMPORTANT: You are responding in a Matrix chat. DO NOT use markdown tables - they don't render correctly. Use bullet lists, numbered lists, or simple text formatting instead. Bold and italic markdown work fine.`
      : "";

    if (sourceFilter === "none") {
      systemPrompt = prompts.noSourcesSystemPrompt;
      if (userContextString) {
        systemPrompt += `\n\n${userContextString}`;
      }
      systemPrompt += matrixFormattingNote;
    } else if (skipRagForTools) {
      // For counting queries, use a special prompt that emphasizes tool usage
      systemPrompt =
        `You are a helpful assistant with access to database query tools. ` +
        `The user has asked a counting or metadata query. You should use the appropriate tool to get accurate results from the database. ` +
        `Do not make up or estimate numbers - only use the exact counts returned by the tools.`;
      if (userContextString) {
        systemPrompt += `\n\n${userContextString}`;
      }
      systemPrompt += matrixFormattingNote;
    } else {
      systemPrompt = interpolatePrompt(prompts.ragSystemPrompt, { context });
      if (userContextString) {
        systemPrompt += `\n\n${userContextString}`;
      }
      systemPrompt += matrixFormattingNote;
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
        const escapeCheckStart = Date.now();
        const escapeCheckMessages = [
          new SystemMessage(systemPrompt),
          new HumanMessage(query),
          new HumanMessage(
            "Can you answer this question with the provided context? Reply with ONLY 'YES' or 'NO'.",
          ),
        ];
        const escapeCheck = await fastModel.invoke(escapeCheckMessages);
        const escapeCheckDuration = Date.now() - escapeCheckStart;

        const canAnswer =
          typeof escapeCheck.content === "string"
            ? escapeCheck.content.trim().toUpperCase()
            : "";

        // Track this call
        const escapeCheckResponse = typeof escapeCheck.content === "string" ? escapeCheck.content : "";
        const escapeCheckModelName = (fastModel as any).modelName || (fastModel as any).model || (fastModel as any).kwargs?.model || "unknown";
        await llmTracker.trackCall("iterative_preview", {
          model: escapeCheckModelName,
          promptTokens: (escapeCheck as any).usage_metadata?.input_tokens || estimateMessageTokens(escapeCheckMessages),
          completionTokens: (escapeCheck as any).usage_metadata?.output_tokens || Math.ceil(escapeCheckResponse.length / 4),
          duration: escapeCheckDuration,
          callPayload: JSON.stringify({
            type: "escape_hatch_check",
            resultCount: searchResults.length,
            decision: canAnswer.includes("NO") ? "upgrade_to_slow_path" : "continue_fast_path",
            request: escapeCheckMessages.map(m => ({
              role: m._getType(),
              content: typeof m.content === "string" ? m.content.substring(0, 300) : "non-string"
            })),
            response: escapeCheckResponse
          }),
        });

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
        const previewStart = Date.now();
        const preview = await fastModel.invoke(previewMessages);
        const previewDuration = Date.now() - previewStart;

        const previewText =
          typeof preview.content === "string"
            ? preview.content.trim().toUpperCase()
            : "";

        // Track this call
        const previewResponse = typeof preview.content === "string" ? preview.content : "";
        const previewModelName = (fastModel as any).modelName || (fastModel as any).model || (fastModel as any).kwargs?.model || "unknown";
        await llmTracker.trackCall("iterative_preview", {
          model: previewModelName,
          promptTokens: (preview as any).usage_metadata?.input_tokens || estimateMessageTokens(previewMessages),
          completionTokens: (preview as any).usage_metadata?.output_tokens || Math.ceil(previewResponse.length / 4),
          duration: previewDuration,
          callPayload: JSON.stringify({
            type: "context_sufficiency_check",
            currentChunks: searchResults.length,
            maxChunks: MAX_TOTAL_CHUNKS,
            decision: previewText.includes("NEED_MORE") ? "retrieve_more" : "sufficient",
            request: previewMessages.map(m => ({
              role: m._getType(),
              content: typeof m.content === "string" ? m.content.substring(0, 300) : "non-string"
            })),
            response: previewResponse
          }),
        });

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
              systemPrompt += matrixFormattingNote;

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

    // Skip tools if we have poor search results for general knowledge queries
    const hasPoorSearchResults = searchResults.length < 3;
    const isGeneralKnowledgeQuery =
      !/\b(book|read|document|file|paperless|goodreads|author|rating|shelf)\b/i.test(query);
    const shouldSkipTools = hasPoorSearchResults && isGeneralKnowledgeQuery && !skipRagForTools;

    if (shouldSkipTools) {
      console.log(
        `[Tools] Skipping tool check - general knowledge query with ${searchResults.length} search results`
      );
    }

    let tools: any[] = [];
    let toolResults: string[] = [];

    if (supportsTools && !shouldSkipTools) {
      try {
        // Get both plugin tools and utility tools
        const pluginTools = await generateToolsForConfiguredPlugins();
        const utilityTools = generateUtilityTools();
        const allTools = [...pluginTools, ...utilityTools];

        // Route tool selection based on query intent
        const toolRouting = routeToolSelection(query);
        tools = filterToolsByRouting(allTools, toolRouting);

        // Log tool selection reasoning
        console.log(explainToolSelection(toolRouting, tools.length));
        if (toolRouting.suggestedTools) {
          console.log(`[ToolRouter] Suggested tools: ${toolRouting.suggestedTools.join(", ")}`);
        }

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

          // OPTIMIZATION: Use single-pass tool calling instead of separate tool check
          // Modern LLMs can decide to use tools and generate response in one call
          // This eliminates the extra LLM call for tool checking

          const modelWithTools = chatModel.bindTools(tools);
          let toolResults: string[] = [];
          let toolCheckResponse: any = null;

          // For streaming responses, we need to collect tool calls first
          // This is unavoidable - we must check for tools before streaming the final response
          const toolCheckStart = Date.now();
          toolCheckResponse = await modelWithTools.invoke(messagesWithGuidance);
          const toolCheckDuration = Date.now() - toolCheckStart;

          // Track tool check call
          const toolCheckResponseText = typeof toolCheckResponse.content === "string" ? toolCheckResponse.content : "";
          const toolModelName = (chatModel as any).modelName || (chatModel as any).model || (chatModel as any).kwargs?.model || "unknown";

          // Only track if tools were actually called (to reduce noise in logs)
          if (toolCheckResponse.tool_calls && toolCheckResponse.tool_calls.length > 0) {
            await llmTracker.trackCall("tool_execution", {
              model: toolModelName,
              promptTokens: (toolCheckResponse as any).usage_metadata?.input_tokens || estimateMessageTokens(messagesWithGuidance),
              completionTokens: (toolCheckResponse as any).usage_metadata?.output_tokens || Math.ceil(toolCheckResponseText.length / 4),
              duration: toolCheckDuration,
              callPayload: JSON.stringify({
                type: "tool_check",
                toolsAvailable: tools.length,
                toolsCalled: toolCheckResponse.tool_calls?.length || 0,
                availableTools: tools.map(t => t.name),
                selectedTools: toolCheckResponse.tool_calls?.map((tc: any) => tc.name) || [],
                request: messagesWithGuidance.map(m => ({
                  role: m._getType(),
                  content: typeof m.content === "string" ? m.content.substring(0, 500) : "non-string"
                })),
                response: toolCheckResponseText.substring(0, 1000)
              }),
            });
          }

          // Check if the response contains tool calls
          if (
            toolCheckResponse.tool_calls &&
            toolCheckResponse.tool_calls.length > 0
          ) {
            // Execute each tool call and track individually
            for (const toolCall of toolCheckResponse.tool_calls) {
              const tool = tools.find((t) => t.name === toolCall.name);
              if (tool) {
                const toolStartTime = Date.now();
                try {
                  // Pass config with matrixRoomId for reminder tools, conversationHistory for note tools, originalQuery for calendar tools
                  const toolConfig = {
                    configurable: {
                      ...(matrixRoomId && { matrixRoomId }),
                      conversationHistory: messages,
                      userId,
                      originalQuery: query, // Pass original query for smart calendar handling
                    }
                  };
                  const result = await tool.func(toolCall.args, toolConfig);
                  const toolDuration = Date.now() - toolStartTime;

                  toolResults.push(
                    `Tool '${toolCall.name}' returned:\n${result}`,
                  );

                  // Track individual tool execution
                  await llmTracker.trackCall("tool_execution", {
                    model: "tool",
                    promptTokens: 0,
                    completionTokens: 0,
                    duration: toolDuration,
                    callPayload: JSON.stringify({
                      type: "tool_call",
                      toolName: toolCall.name,
                      args: toolCall.args,
                      resultLength: result.length,
                      success: true,
                      request: { tool: toolCall.name, args: toolCall.args },
                      response: result.substring(0, 2000)
                    }),
                  });
                } catch (error) {
                  const toolDuration = Date.now() - toolStartTime;
                  const errorMsg = error instanceof Error ? error.message : "Unknown error";

                  toolResults.push(
                    `Tool '${toolCall.name}' failed: ${errorMsg}`,
                  );

                  // Track failed tool execution
                  await llmTracker.trackCall("tool_execution", {
                    model: "tool",
                    promptTokens: 0,
                    completionTokens: 0,
                    duration: toolDuration,
                    callPayload: JSON.stringify({
                      type: "tool_call",
                      toolName: toolCall.name,
                      args: toolCall.args,
                      success: false,
                      request: { tool: toolCall.name, args: toolCall.args },
                      response: errorMsg
                    }),
                    error: errorMsg,
                  });
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
                  const smartResult = await smartSearch(
                    query,
                    undefined,
                    20,
                    (metrics) => llmTracker.trackCall("embedding", {
                      ...metrics,
                      callPayload: JSON.stringify({
                        type: "fallback_search_after_tool_zero",
                        queryLength: query.length,
                        maxChunks: 20
                      })
                    })
                  );
                  searchResults = smartResult.results;
                } else {
                  searchResults = await search(
                    query,
                    20,
                    sourceFilter,
                    (metrics) => llmTracker.trackCall("embedding", {
                      ...metrics,
                      callPayload: JSON.stringify({
                        type: "fallback_search_after_tool_zero",
                        queryLength: query.length,
                        limit: 20,
                        sourceFilter: Array.isArray(sourceFilter) ? sourceFilter.join(',') : sourceFilter
                      })
                    })
                  );
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
                systemPrompt += matrixFormattingNote;
                langchainMessages[0] = new SystemMessage(systemPrompt);

                // Add a note about the fallback
                langchainMessages.push(
                  new SystemMessage(
                    `The metadata query returned no results. However, here is relevant context from semantic search that might help answer the question.`,
                  ),
                );
              } else {
                // Check if reminder tool or note tool was used
                const usedReminderTool = toolCheckResponse.tool_calls?.some((tc: any) =>
                  tc.name === 'create_reminder' || tc.name === 'list_reminders' || tc.name === 'cancel_reminder'
                );
                const usedNoteTool = toolCheckResponse.tool_calls?.some((tc: any) =>
                  tc.name === 'save_assistant_response'
                );

                if (usedReminderTool || usedNoteTool) {
                  langchainMessages.push(
                    new SystemMessage(
                      `Tool execution results:\n\n${toolResultsText}\n\n` +
                      `IMPORTANT: The tool has already completed the user's request. ` +
                      `Simply relay the tool's response to the user in a natural way. Do NOT add extra commentary.`
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
        }
      } catch (error) {
        // Error in tool calling flow, continue without tools
      }
    }

    // Now stream the final response (use fresh model without tools to avoid tool-calling in response)
    const parser = new StringOutputParser();
    const finalModel = await getChatModel(); // Fresh instance without tool binding
    const streamStartTime = Date.now();
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

    // Only include sources if we actually used RAG context
    // For tool-only queries (reminders, counting, etc.) skip sources to reduce noise
    const shouldIncludeSources = !skipRagForTools && searchResults.length > 0;

    const sourcesData: {
      type: string;
      sources: SourceData[];
    } = {
      type: "sources",
      sources: shouldIncludeSources || webSources.length > 0 ? [
        ...searchResults.map((r) => ({
          fileName: r.metadata.fileName,
          filePath: r.metadata.filePath,
          chunk: r.content,
          score: r.score,
          source: r.metadata.source || "synced",
        })),
        ...additionalSources, // Add any sources from iterative retrieval
        ...webSources, // Add any web search sources
      ] : [],
    };

    // Create assistant message record early so it's saved even if client disconnects (skip for internal requests)
    let assistantMessage: any = null;
    if (convId) {
      assistantMessage = await prisma.message.create({
        data: {
          conversationId: convId,
          role: "assistant",
          content: "", // Will be updated as content streams
          sources: JSON.stringify(sourcesData.sources),
        },
      });
    }

    // Collect response for saving
    let fullResponse = "";
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL_MS = 2000; // Save every 2 seconds
    const MIN_CHARS_FOR_SAVE = 50; // Also save after accumulating 50 chars

    // Helper function to save message incrementally
    const saveMessage = async (content: string) => {
      if (!assistantMessage) return; // Skip if no conversation
      try {
        await prisma.message.update({
          where: { id: assistantMessage.id },
          data: { content },
        });
        if (convId) {
          await prisma.conversation.update({
            where: { id: convId },
            data: { updatedAt: new Date() },
          });
        }
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

            // Generate title if this is the first message (skip for internal requests)
            if (messages.length === 1 && convId) {
              try {
                const titlePrompt = interpolatePrompt(
                  prompts.titleGenerationPrompt,
                  {
                    userMessage: query,
                    assistantMessage: fullResponse,
                  },
                );
                const titleModel = await getFastChatModel(); // Use fast model for auxiliary task
                const titleStart = Date.now();
                const titleMessages = [new HumanMessage(titlePrompt)];
                const titleResponse = await titleModel.invoke(titleMessages);
                const titleDuration = Date.now() - titleStart;

                const newTitle =
                  typeof titleResponse.content === "string"
                    ? titleResponse.content.replace(/^["']|["']$/g, "").trim()
                    : "";

                // Track title generation call
                const titleModelName = (titleModel as any).modelName || (titleModel as any).model || (titleModel as any).kwargs?.model || "unknown";
                await llmTracker.trackCall("title_generation", {
                  model: titleModelName,
                  promptTokens: (titleResponse as any).usage_metadata?.input_tokens || estimateMessageTokens(titleMessages),
                  completionTokens: (titleResponse as any).usage_metadata?.output_tokens || Math.ceil(newTitle.length / 4),
                  duration: titleDuration,
                  callPayload: JSON.stringify({
                    type: "conversation_title",
                    conversationId: convId,
                    generatedTitle: newTitle,
                    queryPreview: query.substring(0, 100),
                    responseLength: fullResponse.length
                  }),
                });

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

            // Update conversation topics (async, don't wait) - skip for internal requests
            if (convId) {
              updateConversationTopics(convId, fullResponse).catch((err) =>
                console.error("Failed to update topics:", err),
              );
            }

            // Track LLM usage for this request
            const streamDuration = Date.now() - streamStartTime;
            const finalModelName = (finalModel as any).modelName || (finalModel as any).model || (finalModel as any).kwargs?.model || "unknown";
            await llmTracker.trackCall("chat_completion", {
              model: finalModelName,
              promptTokens: estimateMessageTokens(langchainMessages),
              completionTokens: Math.ceil(fullResponse.length / 4), // Rough estimation
              duration: streamDuration,
              callPayload: JSON.stringify({
                messageCount: langchainMessages.length,
                responseLength: fullResponse.length,
                sourceCount: sourcesData.sources.length,
                request: langchainMessages.map(m => ({
                  role: m._getType(),
                  content: typeof m.content === "string" ? m.content.substring(0, 500) : "non-string"
                })),
                response: fullResponse.substring(0, 2000)
              }),
            });

            // Save all tracked calls to database
            await llmTracker.save().catch((err) =>
              console.error("Failed to save LLM tracking:", err),
            );

            // Analyze which sources were actually referenced
            let analyzedSources = sourcesData.sources;
            if (fullResponse && sourcesData.sources.length > 0) {
              try {
                analyzedSources = await analyzeReferencedSources(
                  fullResponse,
                  sourcesData.sources,
                );

                // Update the stored message with analyzed sources (skip for internal requests)
                if (assistantMessage) {
                  await prisma.message.update({
                    where: { id: assistantMessage.id },
                    data: { sources: JSON.stringify(analyzedSources) },
                  });
                }
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
