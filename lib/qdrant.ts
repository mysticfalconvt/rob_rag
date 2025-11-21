import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from './config';

export const qdrantClient = new QdrantClient({
    url: config.QDRANT_URL,
});

export const COLLECTION_NAME = 'documents';

export async function ensureCollection() {
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);

    if (!exists) {
        await qdrantClient.createCollection(COLLECTION_NAME, {
            vectors: {
                size: 256, // nomic-embed-text uses 256 dimensions
                distance: 'Cosine',
            },
        });
        console.log(`Collection '${COLLECTION_NAME}' created.`);
    }
}
