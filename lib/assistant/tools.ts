import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getMemory,
  getSkill,
  listSkills,
  saveMemory,
  saveSkill,
} from "./store";

/**
 * Tools that expose the assistant's skills & memory to the agent loop. Mirrors
 * the DynamicStructuredTool pattern in lib/tools/noteTool.ts. All are always
 * bound (assembled in lib/agent/runAgent.ts step 4).
 */
export function generateAssistantTools(): DynamicStructuredTool[] {
  return [useSkillTool, recallMemoryTool, saveSkillTool, saveMemoryTool];
}

const useSkillTool = new DynamicStructuredTool({
  name: "use_skill",
  description: `Load the full instructions for one of your available skills.

The system prompt lists AVAILABLE SKILLS with a name and a "Use when" hint. When
the current task matches a skill, call this tool with that skill's exact name to
read its full instructions, then follow them. If you're unsure of the exact name,
call it with an empty/partial name to get the list.`,
  schema: z.object({
    skill_name: z
      .string()
      .describe("The exact name of the skill to load (from AVAILABLE SKILLS)."),
  }),
  func: async ({ skill_name }) => {
    const skill = await getSkill(skill_name);
    if (!skill) {
      const all = await listSkills();
      if (all.length === 0) return "No skills are defined yet.";
      return (
        `No skill named "${skill_name}". Available skills: ` +
        all.map((s) => s.name).join(", ")
      );
    }
    return `# Skill: ${skill.name}\n\n${skill.body}`;
  },
});

const recallMemoryTool = new DynamicStructuredTool({
  name: "recall_memory",
  description: `Read the full detail of a saved memory.

The system prompt lists KNOWN MEMORIES with a name and one-line description. Call
this with a memory's exact name to read its full text when you need the detail.`,
  schema: z.object({
    name: z.string().describe("The exact name of the memory to recall."),
  }),
  func: async ({ name }) => {
    const memory = await getMemory(name);
    if (!memory) return `No memory named "${name}".`;
    return `# Memory: ${memory.name}\n\n${memory.body}`;
  },
});

const saveSkillTool = new DynamicStructuredTool({
  name: "save_skill",
  description: `Save a reusable "skill" — a set of instructions for how to handle
a recurring kind of task — so it can be loaded later via use_skill.

Use this when the user asks to "save this as a skill" or "remember how to do this".
Write clear, self-contained instructions in the body.`,
  schema: z.object({
    name: z.string().describe("Short, descriptive skill name (e.g. 'Weekly status report')."),
    description: z.string().describe("One-line summary of what the skill does."),
    when_to_use: z
      .string()
      .describe("A short hint describing when this skill should be applied."),
    body: z
      .string()
      .describe("The full instructions for the skill, in markdown."),
  }),
  func: async ({ name, description, when_to_use, body }) => {
    try {
      const skill = await saveSkill({
        name,
        description,
        whenToUse: when_to_use,
        body,
      });
      return `✅ Skill saved: **${skill.name}**. It can now be loaded with use_skill.`;
    } catch (error) {
      console.error("[assistant/tools] save_skill error:", error);
      return `❌ Failed to save skill: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});

const saveMemoryTool = new DynamicStructuredTool({
  name: "save_memory",
  description: `Save a durable fact ("memory") to remember across conversations.

Use this when the user shares a lasting fact about themselves or their world, or
says "remember that ...". The memory is injected into future conversations. If you
omit the body, the last assistant message is used.`,
  schema: z.object({
    name: z.string().describe("Short, unique name for the memory (e.g. 'boat')."),
    description: z
      .string()
      .describe("One-line summary used in the memory index."),
    type: z
      .string()
      .optional()
      .describe("Optional category, e.g. 'user', 'preference', 'project', 'reference'."),
    body: z
      .string()
      .optional()
      .describe("The full fact/detail. If omitted, the last assistant message is saved."),
  }),
  func: async ({ name, description, type, body }, toolConfig) => {
    try {
      let content = body;
      if (!content) {
        const history =
          (toolConfig as any)?.configurable?.conversationHistory || [];
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === "assistant" && history[i].content) {
            content = history[i].content;
            break;
          }
        }
      }
      if (!content) {
        return "❌ Cannot save memory: no body provided and no assistant message found.";
      }
      const memory = await saveMemory({ name, description, type, body: content });
      return `✅ Memory saved: **${memory.name}**. I'll take it into account going forward.`;
    } catch (error) {
      console.error("[assistant/tools] save_memory error:", error);
      return `❌ Failed to save memory: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});
