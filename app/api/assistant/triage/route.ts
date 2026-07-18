import { type NextRequest, NextResponse } from "next/server";
import { listMemories, listSkills } from "@/lib/assistant/store";
import { triageConversation } from "@/lib/assistant/triage";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

/**
 * POST { conversationId } → { decision, name?, description?, body?, ... }
 *
 * Runs the post-conversation classifier. Returns { decision: "none" } (and does
 * no model work) when auto-triage is disabled or the conversation can't be
 * triaged, so the client can call this unconditionally after each turn.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const { conversationId } = await req.json();

    // Global toggle. Default on; tolerate the column not existing yet (pre-migration).
    let autoTriage = true;
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
        select: { assistantAutoTriage: true },
      });
      if (settings) autoTriage = settings.assistantAutoTriage;
    } catch {
      autoTriage = true;
    }
    if (!autoTriage || !conversationId) {
      return NextResponse.json({ decision: "none" });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        userId: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true },
        },
      },
    });

    // Only triage the caller's own conversation.
    if (
      !conversation ||
      (conversation.userId !== session.user.id &&
        session.user.role !== "admin")
    ) {
      return NextResponse.json({ decision: "none" });
    }

    const [memories, skills] = await Promise.all([listMemories(), listSkills()]);
    const known = [
      ...memories.map((m) => `memory: ${m.name} — ${m.description}`),
      ...skills.map((s) => `skill: ${s.name} — ${s.description}`),
    ].join("\n");

    const result = await triageConversation(conversation.messages, known);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[api/assistant/triage] error:", error);
    // Never surface triage failures as hard errors to the chat UI.
    return NextResponse.json({ decision: "none" });
  }
}
