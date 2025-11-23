import prisma from "./prisma";

/**
 * Default prompts for the RAG application
 */
export const DEFAULT_PROMPTS = {
  // System prompt when RAG is enabled (with document context)
  ragSystemPrompt: `You are a helpful assistant. Use the following context to answer the user's question.
If the answer is not in the context, say so, but you can still try to answer from general knowledge if appropriate, while noting it's not in the docs.
Always cite your sources if you use the context.

Take into account any user information provided below when personalizing your responses.

Context:
{{context}}`,

  // System prompt when no sources are used (chat-only mode)
  noSourcesSystemPrompt: `You are a helpful assistant. Answer the user's questions to the best of your ability.

Take into account any user information provided below when personalizing your responses.`,

  // Prompt for generating conversation titles
  titleGenerationPrompt: `Generate a short, concise title (maximum 10 words) for this conversation based on the following exchange:
User: {{userMessage}}
Assistant: {{assistantMessage}}

Title:`,
} as const;

export type PromptKey = keyof typeof DEFAULT_PROMPTS;

/**
 * Get prompts from database, falling back to defaults if not set
 */
export async function getPrompts() {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: {
        ragSystemPrompt: true,
        noSourcesSystemPrompt: true,
        titleGenerationPrompt: true,
      },
    });

    return {
      ragSystemPrompt:
        settings?.ragSystemPrompt ?? DEFAULT_PROMPTS.ragSystemPrompt,
      noSourcesSystemPrompt:
        settings?.noSourcesSystemPrompt ??
        DEFAULT_PROMPTS.noSourcesSystemPrompt,
      titleGenerationPrompt:
        settings?.titleGenerationPrompt ??
        DEFAULT_PROMPTS.titleGenerationPrompt,
    };
  } catch (error) {
    console.error("Error fetching prompts from database:", error);
    return DEFAULT_PROMPTS;
  }
}

/**
 * Replace template variables in a prompt string
 */
export function interpolatePrompt(
  template: string,
  variables: Record<string, string>,
): string {
  return Object.entries(variables).reduce(
    (result, [key, value]) => result.replace(`{{${key}}}`, value),
    template,
  );
}
