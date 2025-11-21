import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { config } from './config';

// Initialize the Chat Model (LLM)
export const chatModel = new ChatOpenAI({
    openAIApiKey: config.LM_STUDIO_API_KEY || 'lm-studio',
    configuration: {
        baseURL: config.LM_STUDIO_API_URL,
    },
    modelName: config.CHAT_MODEL_NAME,
    temperature: 0.7,
});

// Initialize the Embeddings Model
export const embeddingsModel = new OpenAIEmbeddings({
    openAIApiKey: config.LM_STUDIO_API_KEY || 'lm-studio',
    configuration: {
        baseURL: config.LM_STUDIO_API_URL,
    },
    modelName: config.EMBEDDING_MODEL_NAME,
});

export async function generateEmbedding(text: string): Promise<number[]> {
    try {
        // Remove newlines to improve embedding quality
        const cleanText = text.replace(/\n/g, ' ');
        const embedding = await embeddingsModel.embedQuery(cleanText);
        return embedding;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw error;
    }
}

export async function getChatCompletion(
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
) {
    try {
        // Convert simple messages to LangChain format if needed, 
        // but ChatOpenAI supports passing role/content objects directly in invoke usually,
        // or we can use the standard invoke method.
        // However, LangChain expects BaseMessage[] or string.
        // Let's map them.

        // Actually, let's keep it simple and expose the model directly or a wrapper.
        // For now, a wrapper that takes our format.

        const response = await chatModel.invoke(
            messages.map(m => {
                if (m.role === 'user') return ['human', m.content];
                if (m.role === 'assistant') return ['ai', m.content];
                return ['system', m.content];
            }) as any // Type casting for simplicity, LangChain types can be complex
        );

        return response.content;
    } catch (error) {
        console.error('Error getting chat completion:', error);
        throw error;
    }
}
