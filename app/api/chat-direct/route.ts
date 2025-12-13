import { type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { getChatModel } from "@/lib/ai";
import { LLMRequestTracker } from "@/lib/llmTracking";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    // Require authentication
    const session = await requireAuth(req);

    const { messages: clientMessages, conversationId } = await req.json();
    const query = clientMessages[clientMessages.length - 1]?.content || "";

    console.log("[DirectLLM] Processing query:", query);
    console.log("[DirectLLM] Conversation ID:", conversationId);

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const conversation = await prisma.conversation.create({
        data: {
          userId: session.user.id,
          title: query.substring(0, 50),
        },
      });
      convId = conversation.id;
      console.log("[DirectLLM] Created new conversation:", convId);
    }

    // Save user message
    const userMessage = await prisma.message.create({
      data: {
        conversationId: convId,
        role: "user",
        content: query,
      },
    });

    // Start LLM tracking
    const llmTracker = new LLMRequestTracker({
      conversationId: convId,
      messageId: userMessage.id,
      userId: session.user.id,
      requestType: "direct_llm",
      requestPayload: JSON.stringify({ query, messageCount: clientMessages.length }),
    });

    // Convert to format expected by LLM
    const messages = clientMessages.map((msg: any) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Get chat model
    const model = await getChatModel();
    const modelName =
      (model as any).modelName ||
      (model as any).model ||
      (model as any).kwargs?.model ||
      "unknown";

    console.log("[DirectLLM] Using model:", modelName);

    // Stream the response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const startTime = Date.now();
          let fullResponse = "";
          let promptTokens = 0;
          let completionTokens = 0;

          // Stream from the model
          const responseStream = await model.stream(messages);

          for await (const chunk of responseStream) {
            const content =
              typeof chunk.content === "string"
                ? chunk.content
                : chunk.content?.toString() || "";

            fullResponse += content;
            controller.enqueue(encoder.encode(content));
          }

          const duration = Date.now() - startTime;

          // Estimate tokens (simplified - real implementation would use actual token counts)
          promptTokens = Math.ceil(
            messages.reduce((sum: number, m: any) => sum + m.content.length, 0) / 4
          );
          completionTokens = Math.ceil(fullResponse.length / 4);

          // Track the LLM call
          await llmTracker.trackCall("chat_completion", {
            model: modelName,
            promptTokens,
            completionTokens,
            duration,
            callPayload: JSON.stringify({
              type: "direct_llm",
              request: messages,
              response: fullResponse,
            }),
          });

          // Save assistant message
          await prisma.message.create({
            data: {
              conversationId: convId,
              role: "assistant",
              content: fullResponse,
            },
          });

          // Save tracking data (messageId was set in constructor via userMessage)
          await llmTracker.save();

          // Send conversation ID at the end
          const metadata = JSON.stringify({
            conversationId: convId,
            sources: [],
          });
          controller.enqueue(encoder.encode(`__SOURCES__:${metadata}`));
          controller.close();
        } catch (error) {
          console.error("[DirectLLM] Stream error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    console.error("[DirectLLM] API error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
