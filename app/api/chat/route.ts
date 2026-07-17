import { type NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/runAgent";
import { initializeApp, initializeMatrix } from "@/lib/init";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

export const maxDuration = 300;

/**
 * Web chat endpoint. This is now a thin adapter around the single `runAgent`
 * orchestrator — all the answering logic (tools, RAG, streaming, persistence,
 * source attribution) lives there and is shared with the Matrix handler and the
 * scheduler, which call `runAgent` in-process rather than POSTing here.
 */
export async function POST(req: NextRequest) {
  try {
    initializeApp();
    initializeMatrix();

    const body = await req.json();
    const {
      messages,
      conversationId,
      sourceFilter,
      sourceCount = 35,
      documentPath,
      webSearchQuery,
      webResearchQuery,
    } = body;

    // Authenticate the web user and load their profile.
    const session = await requireAuth(req);
    const userId = session.user.id;
    const user = await prisma.authUser.findUnique({
      where: { id: userId },
      select: { userName: true, userBio: true, userPreferences: true },
    });
    const userProfile = {
      userName: user?.userName || null,
      userBio: user?.userBio || null,
      userPreferences: user?.userPreferences
        ? JSON.parse(user.userPreferences)
        : null,
    };

    // `#search` / `#research` prefixes become an explicit web intent + a cleaned
    // query, instead of the old bespoke pre-pass. The agent then calls the tool.
    const runMessages = [...messages];
    let webIntent: "search" | "research" | undefined;
    if (webResearchQuery) {
      webIntent = "research";
      runMessages[runMessages.length - 1] = {
        role: "user",
        content: webResearchQuery,
      };
    } else if (webSearchQuery) {
      webIntent = "search";
      runMessages[runMessages.length - 1] = {
        role: "user",
        content: webSearchQuery,
      };
    }

    // Newline-delimited JSON event stream. Each line is one JSON object:
    //   {"type":"token","value":"..."}   — a chunk of the final answer
    //   {"type":"status", ...}            — a progress/activity event
    //   {"type":"sources","sources":[...],"conversationId":"..."}  — final trailer
    // JSON.stringify escapes newlines inside values, so line-splitting is safe.
    const encoder = new TextEncoder();
    const send = (controller: ReadableStreamDefaultController, obj: unknown) =>
      controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));

    const byteStream = new ReadableStream({
      async start(controller) {
        try {
          const result = await runAgent({
            messages: runMessages,
            channel: "web",
            userId,
            userProfile,
            conversationId: conversationId ?? null,
            sourceFilter,
            sourceCount,
            documentPath,
            webIntent,
            onToken: (value) => send(controller, { type: "token", value }),
            onEvent: (event) => send(controller, event),
          });

          send(controller, {
            type: "sources",
            sources: result.sources,
            conversationId: result.conversationId,
          });
          controller.close();
        } catch (error) {
          console.error("[Chat API] runAgent error:", error);
          controller.error(error);
        }
      },
    });

    return new NextResponse(byteStream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Chat API error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
