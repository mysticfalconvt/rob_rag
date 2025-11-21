import { generateEmbedding } from './ai';
import { qdrantClient, COLLECTION_NAME } from './qdrant';

export interface SearchResult {
    content: string;
    metadata: Record<string, any>;
    score: number;
}

export async function search(query: string, limit: number = 5): Promise<SearchResult[]> {
    try {
        const queryEmbedding = await generateEmbedding(query);

        const searchResult = await qdrantClient.search(COLLECTION_NAME, {
            vector: queryEmbedding,
            limit,
            with_payload: true,
        });

        return searchResult.map((res) => ({
            content: res.payload?.content as string,
            metadata: {
                filePath: res.payload?.filePath,
                fileName: res.payload?.fileName,
                fileType: res.payload?.fileType,
                ...res.payload,
            },
            score: res.score,
        }));
    } catch (error) {
        console.error('Error searching:', error);
        return [];
    }
}
