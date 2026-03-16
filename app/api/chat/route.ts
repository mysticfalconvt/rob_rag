import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { type NextRequest, NextResponse } from "next/server";
import { getChatModel, getFastChatModel, estimateMessageTokens } from "@/lib/ai";
import prisma from "@/lib/prisma";
import { getPrompts, interpolatePrompt } from "@/lib/prompts";
import {
  buildUserContext,
  updateConversationTopics,
} from "@/lib/contextBuilder";
import { manageContext } from "@/lib/contextWindow";
import { requireAuth } from "@/lib/session";
import { analyzeReferencedSources } from "@/lib/sourceAnalysis";
import { initializeApp, initializeMatrix } from "@/lib/init";
import { generateToolsForConfiguredPlugins } from "@/lib/toolGenerator";
import { shouldEnableIterativeRetrieval } from "@/lib/retrievalTools";
import { generateUtilityTools } from "@/lib/utilityTools";
import { LLMRequestTracker } from "@/lib/llmTracking";
import { routeToolSelection, filterToolsByRouting, explainToolSelection } from "@/lib/toolRouter";
import { searchWeb, searchDeep, formatWebResultsAsContext, isWebSearchConfigured, isSearXNGConfigured, isPerplexicaConfigured } from "@/lib/webSearch";
import { createRagTool } from "@/lib/tools/ragTool";

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

    // 1. RAG is now a tool — the LLM decides when to search the knowledge base.
    //    We still detect email queries for the fallback path (weak tool-calling models).
    const isEmailQuery = /\b(email|emails|e-mail|inbox|unread mail|mailbox|mail from)\b/i.test(query);

    // 1.5 Handle web search / research commands (these bypass RAG entirely)
    let webContext = "";
    let webSources: any[] = [];

    if (webSearchQuery) {
      console.log(`[WebSearch] Explicit web search triggered: query="${webSearchQuery.substring(0, 80)}", searxng=${isSearXNGConfigured()}, perplexica=${isPerplexicaConfigured()}`);
      const searchStart = Date.now();
      const webResponse = await searchWeb(webSearchQuery);
      const searchDuration = Date.now() - searchStart;
      console.log(`[WebSearch] Web search completed in ${searchDuration}ms: ${webResponse.results.length} results, synthesized=${!!webResponse.synthesizedAnswer}`);
      webContext = formatWebResultsAsContext(webResponse);
      if (webContext) {
        console.log(`[WebSearch] Web context built: ${webContext.length} chars`);
      } else {
        console.warn(`[WebSearch] Web search returned no usable context`);
      }
      webSources = webResponse.results.map((r) => ({
        fileName: r.title,
        filePath: r.url,
        chunk: r.snippet,
        score: r.score || 0,
        source: "web_search",
      }));
    } else if (webResearchQuery) {
      console.log(`[WebSearch] Explicit deep research triggered: query="${webResearchQuery.substring(0, 80)}", perplexica=${isPerplexicaConfigured()}, searxng_fallback=${isSearXNGConfigured()}`);
      const researchStart = Date.now();
      const webResponse = await searchDeep(webResearchQuery);
      const researchDuration = Date.now() - researchStart;
      console.log(`[WebSearch] Deep research completed in ${researchDuration}ms: ${webResponse.results.length} results, synthesized=${!!webResponse.synthesizedAnswer}`);
      webContext = formatWebResultsAsContext(webResponse);
      if (webContext) {
        console.log(`[WebSearch] Research context built: ${webContext.length} chars`);
      } else {
        console.warn(`[WebSearch] Deep research returned no usable context`);
      }
      webSources = webResponse.results.map((r) => ({
        fileName: r.title,
        filePath: r.url,
        chunk: r.snippet,
        score: r.score || 0,
        source: "web_research",
      }));
    } else if (webSearchEnabled && isWebSearchConfigured()) {
      console.log(`[WebSearch] Web search toggle enabled, auto-searching: query="${query.substring(0, 80)}"`);
      const webResponse = await searchWeb(query);
      console.log(`[WebSearch] Auto-search returned ${webResponse.results.length} results`);
      if (webResponse.results.length > 0) {
        webContext = formatWebResultsAsContext(webResponse);
        webSources = webResponse.results.map((r) => ({
          fileName: r.title,
          filePath: r.url,
          chunk: r.snippet,
          score: r.score || 0,
          source: "web_search",
        }));
      }
    } else {
      console.log(`[WebSearch] No web search requested (webSearchQuery=${!!webSearchQuery}, webResearchQuery=${!!webResearchQuery}, webSearchEnabled=${!!webSearchEnabled}, isConfigured=${isWebSearchConfigured()})`);
    }

    // 2. Build system prompt — RAG context is now provided via tool results, not upfront
    const userContextString = buildUserContext(
      userProfile.userName,
      userProfile.userBio,
    );

    const matrixFormattingNote = (triggerSource === "matrix" || triggerSource === "scheduled")
      ? `\n\nIMPORTANT: You are responding in a Matrix chat. DO NOT use markdown tables - they don't render correctly. Use bullet lists, numbered lists, or simple text formatting instead. Bold and italic markdown work fine.` +
        `\n\nYou are a personal AI assistant running in a Matrix chat room. When the user asks what you can do or what capabilities you have, tell them about ALL of the following:` +
        `\n- **Chat commands:** Users can type \`#search <query>\` for quick web searches, \`#research <query>\` for in-depth research, and \`#clear\` to reset conversation context.` +
        `\n- **Knowledge base:** You can search the user's personal documents, books, notes, and files.` +
        `\n- **Web search & research:** You can search the web for current information and perform deep research on complex topics (also available via the #search and #research commands).` +
        `\n- **Email:** You can search, read, and manage the user's connected email accounts.` +
        `\n- **Calendar:** You can look up upcoming events, search by date/attendee/location.` +
        `\n- **Reminders:** You can create, list, and cancel reminders.` +
        `\n- **Notes:** You can save information for later retrieval.` +
        `\n- **Date/time:** You can calculate dates, differences, and provide current date/time info.`
      : "";

    let systemPrompt = prompts.noSourcesSystemPrompt;

    // If web search provided context, inject it into the prompt
    if (webContext) {
      systemPrompt = interpolatePrompt(prompts.ragSystemPrompt, { context: webContext });
    }

    if (userContextString) {
      systemPrompt += `\n\n${userContextString}`;
    }
    systemPrompt += matrixFormattingNote;

    // 3. Apply context window management to prevent token overflow
    const maxTokens = contextSettings?.maxContextTokens ?? 8000;
    const strategy = (contextSettings?.contextStrategy ?? "smart") as
      | "sliding"
      | "token"
      | "smart";
    const windowSize = contextSettings?.slidingWindowSize ?? 10;

    const { messages: managedMessages, summary } = await manageContext(
      messages.slice(0, -1),
      systemPrompt,
      maxTokens,
      strategy,
      windowSize,
    );

    // 4. Prepare messages for LangChain
    const langchainMessages: (SystemMessage | HumanMessage | AIMessage)[] = [
      new SystemMessage(systemPrompt),
    ];

    if (summary) {
      langchainMessages.push(
        new SystemMessage(`Previous conversation summary:\n${summary}`),
      );
    }

    langchainMessages.push(
      ...managedMessages.map((m: any) =>
        m.role === "user"
          ? new HumanMessage(m.content)
          : new AIMessage(m.content),
      ),
    );

    // Add scheduled task context to prevent reminder re-creation
    if (triggerSource === "scheduled") {
      langchainMessages.push(new SystemMessage(
        "This is a scheduled query execution triggered by a previously-created reminder. " +
        "Execute the query and return the results directly. Do NOT create new reminders or suggest creating reminders. " +
        "Simply answer the question or retrieve the requested information."
      ));
    }

    langchainMessages.push(new HumanMessage(query));

    // 5. Set up tools (including RAG as a tool) and check for tool calls before streaming
    const chatModel = await getChatModel();

    const modelName =
      (chatModel as any).modelName || (chatModel as any).model || "";
    const supportsTools = shouldEnableIterativeRetrieval(modelName);

    // Create the RAG tool with per-request config (exclude when sourceFilter is "none")
    // Capture search results via callback for source attribution in the response
    let ragSearchResults: any[] = [];
    const singleDocPath = typeof documentPath === "string" ? documentPath.trim() : null;
    const ragTool = sourceFilter !== "none" ? createRagTool({
      sourceFilter,
      sourceCount: sourceCount || 35,
      documentPath: singleDocPath,
      userName: userProfile.userName,
      userBio: userProfile.userBio,
      isFirstMessage,
      conversationHistory: messages.slice(0, -1),
      onEmbeddingMetrics: (metrics) => llmTracker.trackCall("embedding", {
        ...metrics,
        callPayload: JSON.stringify({ type: "rag_tool_search" }),
      }),
      onSearchResults: (results) => { ragSearchResults = results; },
    }) : null;

    let tools: any[] = [];
    let toolResults: string[] = [];

    if (supportsTools) {
      try {
        // Get plugin tools, utility tools, and RAG tool
        const pluginTools = await generateToolsForConfiguredPlugins();
        const utilityTools = generateUtilityTools();
        const allTools = [
          ...pluginTools,
          ...utilityTools,
          ...(ragTool ? [ragTool] : []),
        ];

        // Route tool selection based on query intent
        const toolRouting = routeToolSelection(query);
        tools = filterToolsByRouting(allTools, toolRouting);

        // Always include RAG tool if available (it's the LLM's choice to use it)
        if (ragTool && !tools.some((t: any) => t.name === "search_knowledge_base")) {
          tools.push(ragTool);
        }

        // Exclude reminder tools for scheduled task execution to prevent re-creation loops
        if (triggerSource === "scheduled") {
          tools = tools.filter((t: any) => !["create_reminder", "list_reminders", "cancel_reminder"].includes(t.name));
        }

        // Log tool selection reasoning
        console.log(explainToolSelection(toolRouting, tools.length));
        if (toolRouting.suggestedTools) {
          console.log(`[ToolRouter] Suggested tools: ${toolRouting.suggestedTools.join(", ")}`);
        }

        if (tools.length > 0) {
          // Add guidance about tool usage
          let toolGuidanceText =
            `You have access to tools. For general knowledge questions (jokes, definitions, math, common facts), ` +
            `answer directly WITHOUT using any tools. ` +
            `For questions about the user's personal data (their books, documents, calendar, files, notes), ` +
            `use the search_knowledge_base tool to find relevant information. ` +
            `When the user asks "how many" or wants to count items, use the appropriate search tool ` +
            `and TRUST THE TOOL'S COUNT RESULT. The tools query the FULL database and return ACCURATE counts.`;

          // Add web search/research guidance when those tools are available
          if (tools.some((t: any) => t.name === "web_search")) {
            toolGuidanceText +=
              ` You have a web_search tool for looking up current events, news, weather, and real-time information. ` +
              `Use it when the user asks about recent events, current facts, or anything that requires up-to-date information.`;
          }
          if (tools.some((t: any) => t.name === "deep_research")) {
            toolGuidanceText +=
              ` You have a deep_research tool for comprehensive, in-depth research on complex topics. ` +
              `Use it when the user asks for thorough analysis, academic research, or detailed investigation of a subject.`;
          }

          // Add email-specific guidance when email tools are available
          if (tools.some((t: any) => t.name.includes("email"))) {
            toolGuidanceText +=
              ` You also have email tools that can search, list, and manage emails across the user's connected accounts. ` +
              `When the user asks about emails, inbox, unread messages, or wants to manage mail, ALWAYS use the email tools. ` +
              `Never say you cannot access the user's email.`;
          }

          const toolGuidanceMessage = new SystemMessage(toolGuidanceText);
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

              {
                // Check if reminder tool or note tool was used
                const usedReminderTool = toolCheckResponse.tool_calls?.some((tc: any) =>
                  tc.name === 'create_reminder' || tc.name === 'list_reminders' || tc.name === 'cancel_reminder'
                );
                const usedNoteTool = toolCheckResponse.tool_calls?.some((tc: any) =>
                  tc.name === 'save_assistant_response'
                );

                if (usedReminderTool || usedNoteTool) {
                  // Replace system prompt to prevent model from hallucinating tool calls
                  langchainMessages[0] = new SystemMessage(
                    `You are a helpful assistant. A tool has already completed the user's request. ` +
                    `Simply relay the tool's response to the user in a natural, conversational way. ` +
                    `Do NOT attempt to call any tools, functions, or output any code. Do NOT add extra commentary.` +
                    (userContextString ? `\n\n${userContextString}` : "") +
                    matrixFormattingNote
                  );
                  langchainMessages.push(
                    new SystemMessage(
                      `Tool execution results:\n\n${toolResultsText}\n\n` +
                      `Relay this result to the user briefly and naturally. Do NOT output tool syntax, code blocks, or function calls.`
                    ),
                  );
                } else {
                  // Check if email tools were used
                  const usedEmailTool = toolCheckResponse.tool_calls?.some((tc: any) =>
                    tc.name.includes("email")
                  );

                  if (usedEmailTool) {
                    // Replace the system prompt to stop the model from hallucinating tool calls
                    langchainMessages[0] = new SystemMessage(
                      `You are a helpful assistant. The user asked about their email. ` +
                      `The email data has already been retrieved and is provided below. ` +
                      `Present the results clearly and helpfully. Do NOT attempt to call any tools or functions.` +
                      (userContextString ? `\n\n${userContextString}` : "") +
                      matrixFormattingNote
                    );
                    langchainMessages.push(
                      new SystemMessage(
                        `Email results:\n\n${toolResultsText}\n\nPresent these email results to the user in a clear, readable format.`,
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
        }
      } catch (error) {
        // Error in tool calling flow, continue without tools
        console.error("[Tools] Tool calling flow error:", error);
      }
    }

    // Fallback: If this is an email query and the LLM didn't call email tools,
    // force-execute the email tool directly. This handles models with poor tool-calling support.
    const emailToolWasCalled = langchainMessages.some(
      (m) => typeof m.content === "string" && m.content.includes("Tool 'search_email'") || m.content.toString().includes("Tool 'list_unread_email'")
    );

    if (isEmailQuery && !emailToolWasCalled) {
      console.log("[EmailFallback] LLM did not call email tools, executing directly");
      try {
        const { getPlugin } = await import("@/lib/plugins");
        const emailPlugin = getPlugin("email");
        if (emailPlugin?.executeTool) {
          // Determine the best tool and params from the query
          const isUnreadQuery = /\b(unread|new|unseen)\b/i.test(query);
          const toolName = isUnreadQuery ? "list_unread_email" : "search_email";

          // Extract search params from query
          const toolParams: any = { userId };

          // Extract date filters
          const todayMatch = /\b(today|today's)\b/i.test(query);
          if (todayMatch) {
            const today = new Date().toISOString().split("T")[0];
            toolParams.after = today;
          }

          // Extract "from" filter — but not time expressions like "from today/this/last"
          const fromMatch = query.match(/(?:from|by)\s+(\S+)/i);
          if (fromMatch) {
            const candidate = fromMatch[1].toLowerCase();
            const timeWords = ["today", "yesterday", "this", "last", "the", "my", "a", "an", "now", "recent"];
            if (!timeWords.includes(candidate)) {
              toolParams.from = fromMatch[1];
            }
          }

          // Extract account filter
          const accountMatch = query.match(/\b([\w.-]+@[\w.-]+\.\w+)\b/);
          if (accountMatch) toolParams.accountEmail = accountMatch[1];

          // Check for specific account references by domain
          if (/\b(zoho|boskind\.tech|\.tech)\b/i.test(query)) {
            // Try to find the Zoho account email
            const emailAccounts = await prisma.emailAccount.findMany({
              where: { userId, enabled: true, provider: "zoho" },
              select: { email: true },
            });
            if (emailAccounts.length > 0) {
              toolParams.accountEmail = emailAccounts[0].email;
            }
          } else if (/\b(gmail|google)\b/i.test(query)) {
            const emailAccounts = await prisma.emailAccount.findMany({
              where: { userId, enabled: true, provider: "gmail" },
              select: { email: true },
            });
            if (emailAccounts.length > 0) {
              toolParams.accountEmail = emailAccounts[0].email;
            }
          }

          console.log(`[EmailFallback] Executing ${toolName} with params:`, toolParams);
          const result = await emailPlugin.executeTool(toolName, toolParams, query);
          console.log(`[EmailFallback] Got result (${result.length} chars)`);

          // Replace system prompt to prevent model from hallucinating tool calls
          langchainMessages[0] = new SystemMessage(
            `You are a helpful assistant. The user asked about their email. ` +
            `The email data has already been retrieved and is provided below. ` +
            `Present the results clearly and helpfully. Do NOT attempt to call any tools or functions.` +
            (userContextString ? `\n\n${userContextString}` : "") +
            matrixFormattingNote
          );
          langchainMessages.push(
            new SystemMessage(
              `Email results:\n\n${result}\n\nPresent these email results to the user in a clear, readable format.`
            ),
          );
        }
      } catch (error) {
        console.error("[EmailFallback] Error:", error);
      }
    }

    // Fallback: If the query likely needs personal data but no tools were called,
    // auto-execute the RAG tool. This handles weak tool-calling models.
    const anyToolWasCalled = langchainMessages.some(
      (m) => typeof m.content === "string" && m.content.includes("Tool '")
    );
    const queryLikelyNeedsRag = /\b(my|book|document|file|paper|read|goodreads|calendar|paperless|uploaded|synced|note)\b/i.test(query);

    if (!anyToolWasCalled && queryLikelyNeedsRag && ragTool && sourceFilter !== "none") {
      console.log("[RAGFallback] LLM did not call any tools for personal-data query, auto-executing RAG");
      try {
        const ragResult = await ragTool.invoke({ query, source_filter: undefined });
        if (ragResult && !ragResult.includes("No relevant documents found")) {
          langchainMessages.push(
            new SystemMessage(
              `Knowledge base search results:\n\n${ragResult}\n\nUse these results to answer the user's question. Cite sources when relevant.`,
            ),
          );
        }
      } catch (error) {
        console.error("[RAGFallback] Error:", error);
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

    // Sources: combine RAG search results (captured via callback) with web search sources
    const sourcesData: {
      type: string;
      sources: SourceData[];
    } = {
      type: "sources",
      sources: [
        ...ragSearchResults.map((r: any) => ({
          fileName: r.metadata.fileName,
          filePath: r.metadata.filePath,
          chunk: r.content,
          score: r.score,
          source: r.metadata.source || "synced",
        })),
        ...webSources,
      ],
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
