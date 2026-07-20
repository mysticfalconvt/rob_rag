import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { estimateMessageTokens, getChatModel, getFastChatModel } from "../ai";
import { buildUserContext, updateConversationTopics } from "../contextBuilder";
import { manageContext } from "../contextWindow";
import { LLMRequestTracker } from "../llmTracking";
import prisma from "../prisma";
import { getPrompts, interpolatePrompt } from "../prompts";
import { analyzeReferencedSources } from "../sourceAnalysis";
import { generateToolsForConfiguredPlugins } from "../toolGenerator";
import { createRagTool } from "../tools/ragTool";
import { generateUtilityTools } from "../utilityTools";
import { generateAssistantTools } from "../assistant/tools";
import {
  buildMemoryIndex,
  buildSkillsCatalog,
  listMemories,
  listSkills,
  readSoul,
} from "../assistant/store";
import {
  filterToolsByCapabilities,
  ragSourceFilterForCapabilities,
} from "./capabilities";
import { runToolLoop } from "./loop";
import {
  createAssistantMessage,
  resolveConversation,
  saveUserMessage,
  touchConversation,
  updateAssistantMessage,
} from "./persistence";
import { SourceCollector } from "./sourceCollector";
import { buildSystemPrompt } from "./systemPrompt";
import type { RunAgentInput, RunAgentResult } from "./types";

const REMINDER_TOOL_NAMES = [
  "create_reminder",
  "list_reminders",
  "cancel_reminder",
];

const SAVE_INTERVAL_MS = 2000;

/**
 * The single answering path. Every entry point (web route, Matrix handler,
 * scheduler) calls this in-process. "Mode" is no longer a user toggle — the
 * agent decides whether to search / use tools / just answer via the tool loop.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const {
    messages,
    channel,
    userId,
    userProfile,
    conversationId = null,
    disableTools = false,
    sourceFilter,
    sourceCount = 35,
    documentPath,
    matrixRoomId,
    webIntent,
    allowedCapabilities,
    onToken,
    onEvent,
  } = input;

  // Per-user capability gating. null => unrestricted (default).
  const allowedCaps =
    allowedCapabilities != null ? new Set(allowedCapabilities) : null;

  const lastMessage = messages[messages.length - 1];
  const query = lastMessage?.content ?? ""; // raw text — for storage, RAG, tools
  const lastAuthor = lastMessage?.authorName;
  const isFirstMessage = messages.length === 1;
  const history = messages.slice(0, -1); // raw — for RAG rephrase context

  // Attribute multi-speaker turns for the MODEL only (storage stays raw). In a
  // shared Matrix room/thread this lets the agent tell who said what.
  const attribute = (m: {
    role: string;
    content: string;
    authorName?: string;
  }) =>
    m.role === "user" && m.authorName
      ? `${m.authorName}: ${m.content}`
      : m.content;
  const attributedHistory = history.map((m) => ({
    role: m.role,
    content: attribute(m),
  }));
  const attributedQuery = attribute(lastMessage);

  // 1. Prompts + context settings + assistant soul/skills/memory.
  const [prompts, contextSettings, soul, skills, memories] = await Promise.all([
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
    readSoul(),
    listSkills(),
    listMemories(),
  ]);

  // 2. Conversation + persist the user's message.
  const convId = await resolveConversation({
    channel,
    userId,
    conversationId,
    matrixRoomId,
    firstMessageText: query,
  });
  const userMessage = await saveUserMessage(convId, query, lastAuthor);

  // 3. LLM request tracker.
  const tracker = new LLMRequestTracker({
    conversationId: convId,
    messageId: userMessage.id,
    userId,
    requestType:
      channel === "matrix"
        ? "matrix_chat"
        : channel === "scheduled"
          ? "scheduled_task"
          : "user_chat",
    requestPayload: JSON.stringify({
      query: query.substring(0, 200),
      channel,
      sourceFilter,
      sourceCount,
      isFirstMessage,
      matrixRoomId,
    }),
  });

  // 4. Assemble tools (all configured tools are bound; the agent chooses).
  const sourceCollector = new SourceCollector();
  let tools: DynamicStructuredTool[] = [];

  // Scope RAG document sources to the user's permitted sources. "none" from the
  // caller (RAG explicitly off) always wins; otherwise capabilities may narrow
  // the filter or disable RAG (knowledge_base denied).
  let effectiveSourceFilter = sourceFilter;
  if (sourceFilter !== "none" && allowedCaps) {
    const capFilter = ragSourceFilterForCapabilities(allowedCaps);
    if (capFilter === "none") effectiveSourceFilter = "none";
    else if (Array.isArray(capFilter)) effectiveSourceFilter = capFilter;
  }

  if (!disableTools) {
    const [pluginTools, utilityTools] = [
      await generateToolsForConfiguredPlugins(),
      generateUtilityTools(),
    ];

    const ragTool =
      effectiveSourceFilter !== "none"
        ? createRagTool({
            sourceFilter: effectiveSourceFilter,
            sourceCount: sourceCount || 35,
            documentPath:
              typeof documentPath === "string" ? documentPath.trim() : null,
            userName: userProfile.userName,
            userBio: userProfile.userBio,
            isFirstMessage,
            conversationHistory: history,
            onEmbeddingMetrics: (metrics) =>
              tracker.trackCall("embedding", {
                ...metrics,
                callPayload: JSON.stringify({ type: "rag_tool_search" }),
              }),
            onSearchResults: (results) =>
              sourceCollector.addRagResults(results),
          })
        : null;

    tools = [
      ...pluginTools,
      ...utilityTools,
      ...generateAssistantTools(),
      ...(ragTool ? [ragTool] : []),
    ];

    // Reminder tools depend on a Matrix room and only make sense there.
    if (channel !== "matrix") {
      tools = tools.filter((t) => !REMINDER_TOOL_NAMES.includes(t.name));
    }

    // Per-user capability gating: drop any tool outside the permitted groups.
    tools = filterToolsByCapabilities(tools, allowedCaps);
  }

  // 5. System prompt (single canonical builder).
  const userContextString = buildUserContext(
    userProfile.userName,
    userProfile.userBio,
  );
  const toolNames = tools.map((t) => t.name);
  const systemPrompt = buildSystemPrompt({
    basePrompt: prompts.noSourcesSystemPrompt,
    userContext: userContextString,
    channel,
    toolNames,
    isScheduled: channel === "scheduled",
    matrixFormattingPrompt: prompts.matrixFormattingPrompt,
    webIntent,
    soul,
    // Only advertise skills/memory when their tools are actually bound.
    skillsCatalog: toolNames.includes("use_skill")
      ? buildSkillsCatalog(skills)
      : undefined,
    memoryIndex: toolNames.includes("recall_memory")
      ? buildMemoryIndex(memories)
      : undefined,
  });

  // 6. Context-window management over prior turns.
  const maxTokens = contextSettings?.maxContextTokens ?? 8000;
  const strategy = (contextSettings?.contextStrategy ?? "smart") as
    | "sliding"
    | "token"
    | "smart";
  const windowSize = contextSettings?.slidingWindowSize ?? 10;
  const { messages: managedMessages, summary } = await manageContext(
    attributedHistory,
    systemPrompt,
    maxTokens,
    strategy,
    windowSize,
  );

  // 7. Build the LangChain message list.
  const langchainMessages: BaseMessage[] = [new SystemMessage(systemPrompt)];
  if (summary) {
    langchainMessages.push(
      new SystemMessage(`Previous conversation summary:\n${summary}`),
    );
  }
  langchainMessages.push(
    ...managedMessages.map((m: { role: string; content: string }) =>
      m.role === "user"
        ? new HumanMessage(m.content)
        : new AIMessage(m.content),
    ),
  );
  langchainMessages.push(new HumanMessage(attributedQuery));

  // 8. Assistant message row (saved incrementally so it survives disconnects).
  const assistantMessage = await createAssistantMessage(convId);
  let fullResponse = "";
  let lastSaveTime = Date.now();

  const wrappedOnToken = async (delta: string) => {
    fullResponse += delta;
    if (onToken) await onToken(delta);
    const now = Date.now();
    if (now - lastSaveTime >= SAVE_INTERVAL_MS) {
      lastSaveTime = now;
      updateAssistantMessage(assistantMessage.id, fullResponse).catch((err) =>
        console.error("[runAgent] incremental save error:", err),
      );
    }
  };

  // 9. Run the tool-calling loop.
  const model = await getChatModel();
  const streamStart = Date.now();
  let finalText = "";
  try {
    const result = await runToolLoop({
      model,
      tools,
      messages: langchainMessages,
      toolConfig: {
        configurable: {
          ...(matrixRoomId ? { matrixRoomId } : {}),
          conversationHistory: messages,
          userId,
          originalQuery: query,
          sourceCollector,
        },
      },
      tracker,
      onToken: wrappedOnToken,
      onEvent,
    });
    finalText = result.finalText;
  } catch (error) {
    console.error("[runAgent] tool loop error:", error);
    // Persist whatever we streamed before failing.
    await updateAssistantMessage(assistantMessage.id, fullResponse).catch(
      () => {},
    );
    await tracker.save().catch(() => {});
    throw error;
  }

  // 10. Post-processing: final save, sources, title, topics, tracking.
  await updateAssistantMessage(assistantMessage.id, finalText);
  await touchConversation(convId).catch(() => {});

  // Title generation on the first web message only.
  if (isFirstMessage && channel === "web") {
    try {
      const titlePrompt = interpolatePrompt(prompts.titleGenerationPrompt, {
        userMessage: query,
        assistantMessage: finalText,
      });
      const titleModel = await getFastChatModel();
      const titleStart = Date.now();
      const titleMessages = [new HumanMessage(titlePrompt)];
      const titleResponse = await titleModel.invoke(titleMessages);
      const newTitle =
        typeof titleResponse.content === "string"
          ? titleResponse.content.replace(/^["']|["']$/g, "").trim()
          : "";
      await tracker.trackCall("title_generation", {
        model: (titleModel as any).modelName || "unknown",
        promptTokens:
          (titleResponse as any).usage_metadata?.input_tokens ||
          estimateMessageTokens(titleMessages),
        completionTokens:
          (titleResponse as any).usage_metadata?.output_tokens ||
          Math.ceil(newTitle.length / 4),
        duration: Date.now() - titleStart,
        callPayload: JSON.stringify({
          type: "conversation_title",
          conversationId: convId,
          generatedTitle: newTitle,
        }),
      });
      if (newTitle) {
        await prisma.conversation.update({
          where: { id: convId },
          data: { title: newTitle },
        });
      }
    } catch (error) {
      console.error("[runAgent] title generation failed:", error);
    }
  }

  // Topic extraction (async, best-effort).
  updateConversationTopics(convId, finalText).catch((err) =>
    console.error("[runAgent] topic update failed:", err),
  );

  // Final chat-completion tracking snapshot.
  await tracker.trackCall("chat_completion", {
    model: (model as any).modelName || "unknown",
    promptTokens: estimateMessageTokens(langchainMessages),
    completionTokens: Math.ceil(finalText.length / 4),
    duration: Date.now() - streamStart,
    callPayload: JSON.stringify({
      type: "agent_run",
      responseLength: finalText.length,
      sourceCount: sourceCollector.getAll().length,
    }),
  });
  await tracker
    .save()
    .catch((err) => console.error("[runAgent] tracker save failed:", err));

  // Source attribution: figure out which sources the answer actually used.
  let sources = sourceCollector.getAll();
  if (finalText && sources.length > 0) {
    try {
      sources = await analyzeReferencedSources(finalText, sources);
    } catch (error) {
      console.error("[runAgent] source analysis failed:", error);
    }
    // Always surface web sources as citations: if the agent searched the web to
    // answer, the user should see where the data came from. (Embedding-based
    // relevance is unreliable for short web snippets vs a synthesized answer.)
    sources = sources.map((s) =>
      s.source === "web_search" || s.source === "web_research"
        ? { ...s, isReferenced: true }
        : s,
    );
  }
  await updateAssistantMessage(assistantMessage.id, finalText, sources).catch(
    () => {},
  );

  return { text: finalText, sources, conversationId: convId };
}
