import { HumanMessage } from "@langchain/core/messages";
import { getFastChatModel } from "../ai";

/**
 * Post-conversation triage: decide whether a conversation produced something
 * worth saving as a durable memory or a reusable skill. Runs on the fast model
 * (same pattern as topic extraction in lib/contextBuilder.ts). The overwhelming
 * majority of conversations should return "none".
 */

export interface TriageResult {
  decision: "none" | "memory" | "skill";
  name?: string;
  description?: string;
  body?: string;
  /** memory only */
  type?: string;
  /** skill only */
  whenToUse?: string;
}

const TRIAGE_PROMPT = `You review a finished chat between a user and their personal assistant and decide
whether anything durable is worth saving. Be conservative: MOST conversations are
one-off and should be saved as NOTHING.

Save a MEMORY only for a lasting, factual detail about the user or their world that
would help in unrelated future chats (e.g. "the user's boat is a Bayliner 2858",
"the user's spouse is named Dana"). Do NOT save transient task details, questions,
or anything already listed in KNOWN ITEMS below.

Save a SKILL only if the conversation established a reusable, repeatable procedure
the assistant should follow next time (e.g. "how to format the weekly status report").
A skill is instructions, not a fact.

KNOWN ITEMS (do not duplicate these):
{{known}}

CONVERSATION:
{{conversation}}

Respond with ONLY a JSON object, no prose. Shape:
{"decision":"none"}
or {"decision":"memory","name":"short-name","description":"one line","type":"user|preference|project|reference","body":"the fact in a sentence or two"}
or {"decision":"skill","name":"Short Name","description":"one line","whenToUse":"when to apply","body":"the full instructions"}`;

export async function triageConversation(
  messages: { role: string; content: string }[],
  knownIndex: string,
): Promise<TriageResult> {
  try {
    const convo = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    if (!convo.trim()) return { decision: "none" };

    const prompt = TRIAGE_PROMPT.replace(
      "{{known}}",
      knownIndex.trim() || "(none)",
    ).replace("{{conversation}}", convo);

    const model = await getFastChatModel();
    const response = await model.invoke([new HumanMessage(prompt)]);
    const text =
      typeof response.content === "string" ? response.content.trim() : "";

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { decision: "none" };

    const parsed = JSON.parse(match[0]);
    if (parsed?.decision === "memory" && parsed.name && parsed.body) {
      return {
        decision: "memory",
        name: String(parsed.name),
        description: String(parsed.description ?? ""),
        type: parsed.type ? String(parsed.type) : "note",
        body: String(parsed.body),
      };
    }
    if (parsed?.decision === "skill" && parsed.name && parsed.body) {
      return {
        decision: "skill",
        name: String(parsed.name),
        description: String(parsed.description ?? ""),
        whenToUse: String(parsed.whenToUse ?? ""),
        body: String(parsed.body),
      };
    }
    return { decision: "none" };
  } catch (error) {
    console.error("[assistant/triage] failed:", error);
    return { decision: "none" };
  }
}
