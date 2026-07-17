import {
  AIMessage,
  type AIMessageChunk,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ChatOpenAI } from "@langchain/openai";
import { estimateMessageTokens } from "../ai";
import type { LLMRequestTracker } from "../llmTracking";
import type { AgentToolConfigurable } from "./types";

/**
 * Maximum number of model turns. A "turn" is one model call; a turn either
 * requests tools (which we execute and feed back) or produces the final answer.
 * The cap guards against runaway loops on models that never stop calling tools.
 */
const MAX_ITERATIONS = 6;

/**
 * Run a bounded ReAct-style tool-calling loop.
 *
 * Replaces the old single-invoke tool-check + regex fallbacks + fresh-model
 * restream. The model can now chain tools across multiple turns (e.g. search the
 * knowledge base, then read a full document, then answer). The final answer turn
 * is streamed token-by-token via `onToken`.
 *
 * Streaming strategy: we stream every turn. On OpenAI-style models a turn emits
 * either tool-call deltas or user-facing content, not both, so we forward content
 * deltas live and suppress anything from a turn that turns out to be a tool call.
 */
export async function runToolLoop(args: {
  model: ChatOpenAI;
  tools: DynamicStructuredTool[];
  messages: BaseMessage[];
  toolConfig: { configurable: AgentToolConfigurable };
  tracker: LLMRequestTracker;
  onToken?: (delta: string) => void | Promise<void>;
}): Promise<{ finalText: string }> {
  const { model, tools, messages, toolConfig, tracker, onToken } = args;
  const modelName =
    (model as any).modelName || (model as any).model || "unknown";
  const convo: BaseMessage[] = [...messages];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // On the last permitted iteration, bind no tools so the model is forced to
    // produce a prose answer — the user always gets a reply.
    const isLastAllowed = iteration === MAX_ITERATIONS - 1;
    const bound =
      tools.length > 0 && !isLastAllowed ? model.bindTools(tools) : model;

    const turnStart = Date.now();
    const stream = await bound.stream(convo);

    let gathered: AIMessageChunk | undefined;
    let isToolTurn = false;
    let streamedText = "";

    for await (const chunk of stream) {
      gathered = gathered !== undefined ? gathered.concat(chunk) : chunk;

      if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
        isToolTurn = true;
      }

      const delta = typeof chunk.content === "string" ? chunk.content : "";
      if (delta && !isToolTurn) {
        streamedText += delta;
        if (onToken) await onToken(delta);
      }
    }

    if (!gathered) break;

    const toolCalls = gathered.tool_calls ?? [];
    const contentText =
      typeof gathered.content === "string" ? gathered.content : streamedText;

    // Track this model turn.
    await tracker.trackCall(
      toolCalls.length > 0 ? "tool_execution" : "chat_completion",
      {
        model: modelName,
        promptTokens:
          (gathered as any).usage_metadata?.input_tokens ||
          estimateMessageTokens(convo),
        completionTokens:
          (gathered as any).usage_metadata?.output_tokens ||
          Math.ceil(contentText.length / 4),
        duration: Date.now() - turnStart,
        callPayload: JSON.stringify({
          type: toolCalls.length > 0 ? "tool_planning" : "final_answer",
          iteration,
          toolsAvailable: tools.length,
          toolsCalled: toolCalls.map((tc: any) => tc.name),
        }),
      },
    );

    // No tool calls -> this turn is the final answer (already streamed live).
    if (toolCalls.length === 0) {
      // If content only became available at the end (no live deltas), emit it now.
      if (!streamedText && contentText && onToken) {
        await onToken(contentText);
      }
      return { finalText: streamedText || contentText };
    }

    // Tool turn: record the assistant's tool-call message, then execute each call
    // and feed results back as ToolMessages for the next turn.
    convo.push(
      new AIMessage({ content: gathered.content ?? "", tool_calls: toolCalls }),
    );

    for (const tc of toolCalls) {
      const toolCallId = tc.id ?? tc.name;
      const tool = tools.find((t) => t.name === tc.name);
      const toolStart = Date.now();

      if (!tool) {
        convo.push(
          new ToolMessage({
            content: `Tool '${tc.name}' is not available.`,
            tool_call_id: toolCallId,
            name: tc.name,
          }),
        );
        continue;
      }

      try {
        const result = await tool.invoke(tc.args, toolConfig);
        const resultStr =
          typeof result === "string" ? result : JSON.stringify(result);
        convo.push(
          new ToolMessage({
            content: resultStr,
            tool_call_id: toolCallId,
            name: tc.name,
          }),
        );
        await tracker.trackCall("tool_execution", {
          model: "tool",
          promptTokens: 0,
          completionTokens: 0,
          duration: Date.now() - toolStart,
          callPayload: JSON.stringify({
            type: "tool_call",
            toolName: tc.name,
            args: tc.args,
            resultLength: resultStr.length,
            success: true,
            response: resultStr.substring(0, 2000),
          }),
        });
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        convo.push(
          new ToolMessage({
            content: `Tool '${tc.name}' failed: ${errorMsg}`,
            tool_call_id: toolCallId,
            name: tc.name,
          }),
        );
        await tracker.trackCall("tool_execution", {
          model: "tool",
          promptTokens: 0,
          completionTokens: 0,
          duration: Date.now() - toolStart,
          callPayload: JSON.stringify({
            type: "tool_call",
            toolName: tc.name,
            args: tc.args,
            success: false,
          }),
          error: errorMsg,
        });
      }
    }
  }

  // Safety net: exhausted iterations without a final answer. Force one plain,
  // tool-less streamed turn so the user still gets a response.
  const finalStream = await model.stream(convo);
  let tail = "";
  for await (const chunk of finalStream) {
    const delta = typeof chunk.content === "string" ? chunk.content : "";
    if (delta) {
      tail += delta;
      if (onToken) await onToken(delta);
    }
  }
  return { finalText: tail };
}

export { MAX_ITERATIONS };
