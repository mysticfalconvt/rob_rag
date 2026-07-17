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
    onToken,
  } = input;

  const lastMessage = messages[messages.length - 1];
  const query = lastMessage?.content ?? "";
  const isFirstMessage = messages.length === 1;
  const history = messages.slice(0, -1);

  // 1. Prompts + context settings.
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

  // 2. Conversation + persist the user's message.
  const convId = await resolveConversation({
    channel,
    userId,
    conversationId,
    matrixRoomId,
    firstMessageText: query,
  });
  const userMessage = await saveUserMessage(convId, query);

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

  if (!disableTools) {
    const [pluginTools, utilityTools] = [
      await generateToolsForConfiguredPlugins(),
      generateUtilityTools(),
    ];

    const ragTool =
      sourceFilter !== "none"
        ? createRagTool({
            sourceFilter,
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

    tools = [...pluginTools, ...utilityTools, ...(ragTool ? [ragTool] : [])];

    // Reminder tools depend on a Matrix room and only make sense there.
    if (channel !== "matrix") {
      tools = tools.filter((t) => !REMINDER_TOOL_NAMES.includes(t.name));
    }
  }

  // 5. System prompt (single canonical builder).
  const userContextString = buildUserContext(
    userProfile.userName,
    userProfile.userBio,
  );
  const systemPrompt = buildSystemPrompt({
    basePrompt: prompts.noSourcesSystemPrompt,
    userContext: userContextString,
    channel,
    toolNames: tools.map((t) => t.name),
    isScheduled: channel === "scheduled",
    matrixFormattingPrompt: prompts.matrixFormattingPrompt,
    webIntent,
  });

  // 6. Context-window management over prior turns.
  const maxTokens = contextSettings?.maxContextTokens ?? 8000;
  const strategy = (contextSettings?.contextStrategy ?? "smart") as
    | "sliding"
    | "token"
    | "smart";
  const windowSize = contextSettings?.slidingWindowSize ?? 10;
  const { messages: managedMessages, summary } = await manageContext(
    history,
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
  langchainMessages.push(new HumanMessage(query));

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
  }
  await updateAssistantMessage(assistantMessage.id, finalText, sources).catch(
    () => {},
  );

  return { text: finalText, sources, conversationId: convId };
}
