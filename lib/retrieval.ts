import { generateEmbedding } from './ai';
import { qdrantClient, COLLECTION_NAME, ensureCollection } from './qdrant';
import { config } from './config';
// Using built‑in fetch (Node 18+ / Turbopack provides a global fetch)

export interface SearchResult {
    content: string;
    metadata: Record<string, any>;
    score: number;
}

export async function search(
    query: string, 
    limit: number = 5, 
    sourceFilter?: 'all' | 'uploaded' | 'synced' | 'paperless' | 'none'
): Promise<SearchResult[]> {
    try {
        const queryEmbedding = await generateEmbedding(query);

        // Ensure the collection exists (creates it if missing)
        await ensureCollection();
        console.log('[Qdrant] Performing search via direct HTTP POST');
        
        // Build filter based on source
        const filter: any = sourceFilter && sourceFilter !== 'all' ? {
            must: [
                {
                    key: 'source',
                    match: {
                        value: sourceFilter
                    }
                }
            ]
        } : undefined;

        const response = await fetch(`${config.QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vector: queryEmbedding,
                top: limit, // Qdrant expects 'top' for number of results
                with_payload: true,
                filter,
            }),
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Qdrant search failed ${response.status}: ${response.statusText} – ${errBody}`);
        }

        const data = await response.json();
        // Qdrant search response format: { result: [ { id, score, payload, ... }, ... ], status: 'ok', ... }
        const points = Array.isArray(data.result) ? data.result : [];
        // console.log('[Qdrant] Search returned', points.length, 'points');

        return points.map((p: any) => ({
            content: p.payload?.content as string,
            metadata: {
                filePath: p.payload?.filePath,
                fileName: p.payload?.fileName,
                fileType: p.payload?.fileType,
                ...p.payload,
            },
            score: p.score ?? 0,
        }));
    } catch (error) {
        console.error('Error searching:', error);
        return [];
    }
}
