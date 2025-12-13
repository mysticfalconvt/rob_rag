import prisma from "./prisma";

export type LLMCallType =
  | "chat_completion"
  | "embedding"
  | "title_generation"
  | "topic_extraction"
  | "query_classification"
  | "query_rephrasing"
  | "iterative_preview"
  | "source_analysis"
  | "tool_execution"
  | "context_summary";

export type LLMRequestType =
  | "user_chat"
  | "direct_llm"
  | "background_processing"
  | "system_task";

export interface LLMCallMetrics {
  model: string;
  promptTokens: number;
  completionTokens: number;
  duration: number; // milliseconds
  callPayload?: string;
  error?: string;
}

export interface LLMRequestMetrics {
  conversationId?: string;
  messageId?: string;
  userId?: string;
  requestType: LLMRequestType;
  model: string;
  promptTokens: number;
  completionTokens: number;
  duration: number; // milliseconds
  requestPayload: string;
  error?: string;
}

/**
 * Tracker for individual LLM requests (e.g., a user's chat message)
 * Aggregates multiple LLM calls made during the request
 */
export class LLMRequestTracker {
  private requestId: string | null = null;
  private conversationId?: string;
  private messageId?: string;
  private userId?: string;
  private requestType: LLMRequestType;
  private startTime: number;
  private calls: Array<{
    callType: LLMCallType;
    metrics: LLMCallMetrics;
  }> = [];
  private requestPayload: string;

  constructor(options: {
    conversationId?: string;
    messageId?: string;
    userId?: string;
    requestType: LLMRequestType;
    requestPayload: string;
  }) {
    this.conversationId = options.conversationId;
    this.messageId = options.messageId;
    this.userId = options.userId;
    this.requestType = options.requestType;
    this.requestPayload = options.requestPayload;
    this.startTime = Date.now();
  }

  /**
   * Track an individual LLM call within this request
   */
  async trackCall(callType: LLMCallType, metrics: LLMCallMetrics) {
    this.calls.push({ callType, metrics });

    // If we already saved the request, add this call to the DB
    if (this.requestId) {
      const tokensPerSecond = metrics.duration > 0
        ? (metrics.completionTokens / (metrics.duration / 1000))
        : 0;

      await prisma.lLMCall.create({
        data: {
          requestId: this.requestId,
          callType,
          model: metrics.model,
          promptTokens: metrics.promptTokens,
          completionTokens: metrics.completionTokens,
          totalTokens: metrics.promptTokens + metrics.completionTokens,
          duration: metrics.duration,
          tokensPerSecond,
          callPayload: metrics.callPayload,
          error: metrics.error,
        },
      });
    }
  }

  /**
   * Save the request and all calls to the database
   */
  async save() {
    if (this.requestId) {
      // Already saved
      return this.requestId;
    }

    const totalDuration = Date.now() - this.startTime;
    const totalPromptTokens = this.calls.reduce((sum, call) => sum + call.metrics.promptTokens, 0);
    const totalCompletionTokens = this.calls.reduce((sum, call) => sum + call.metrics.completionTokens, 0);
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const tokensPerSecond = totalDuration > 0
      ? (totalCompletionTokens / (totalDuration / 1000))
      : 0;

    // Get the primary model used (most common in calls, or first one)
    const primaryModel = this.calls.length > 0
      ? this.calls[0].metrics.model
      : "unknown";

    const hasError = this.calls.some(call => call.metrics.error);
    const firstError = this.calls.find(call => call.metrics.error)?.metrics.error;

    const request = await prisma.lLMRequest.create({
      data: {
        conversationId: this.conversationId,
        messageId: this.messageId,
        userId: this.userId,
        requestType: this.requestType,
        model: primaryModel,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens,
        duration: totalDuration,
        tokensPerSecond,
        requestPayload: this.requestPayload,
        error: hasError ? firstError : undefined,
        calls: {
          create: this.calls.map(({ callType, metrics }) => ({
            callType,
            model: metrics.model,
            promptTokens: metrics.promptTokens,
            completionTokens: metrics.completionTokens,
            totalTokens: metrics.promptTokens + metrics.completionTokens,
            duration: metrics.duration,
            tokensPerSecond: metrics.duration > 0
              ? (metrics.completionTokens / (metrics.duration / 1000))
              : 0,
            callPayload: metrics.callPayload,
            error: metrics.error,
          })),
        },
      },
    });

    this.requestId = request.id;
    return request.id;
  }

  /**
   * Get summary of this request
   */
  getSummary() {
    const totalDuration = Date.now() - this.startTime;
    const totalPromptTokens = this.calls.reduce((sum, call) => sum + call.metrics.promptTokens, 0);
    const totalCompletionTokens = this.calls.reduce((sum, call) => sum + call.metrics.completionTokens, 0);
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const tokensPerSecond = totalDuration > 0
      ? (totalCompletionTokens / (totalDuration / 1000))
      : 0;

    return {
      totalCalls: this.calls.length,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalDuration,
      tokensPerSecond: tokensPerSecond.toFixed(2),
      calls: this.calls.map(({ callType, metrics }) => ({
        callType,
        model: metrics.model,
        tokens: metrics.promptTokens + metrics.completionTokens,
        duration: metrics.duration,
      })),
    };
  }
}

/**
 * Convenience function to track a single LLM call
 */
export async function trackSingleCall(
  callType: LLMCallType,
  metrics: LLMCallMetrics,
  options?: {
    conversationId?: string;
    messageId?: string;
    userId?: string;
  }
) {
  const tracker = new LLMRequestTracker({
    conversationId: options?.conversationId,
    messageId: options?.messageId,
    userId: options?.userId,
    requestType: "system_task",
    requestPayload: JSON.stringify({ callType }),
  });

  await tracker.trackCall(callType, metrics);
  await tracker.save();
}

/**
 * Helper to measure duration and token usage for an LLM call
 */
export async function measureLLMCall<T>(
  fn: () => Promise<T>,
  options: {
    onComplete: (result: T, duration: number) => LLMCallMetrics;
  }
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    const metrics = options.onComplete(result, duration);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    throw error;
  }
}
