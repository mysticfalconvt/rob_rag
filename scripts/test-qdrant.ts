import './setup-env';
import { qdrantClient, ensureCollection } from '../lib/qdrant';

async function testQdrant() {
    console.log('Testing Qdrant connection...');
    try {
        const collections = await qdrantClient.getCollections();
        console.log('Connected to Qdrant!');
        console.log('Existing collections:', collections.collections.map(c => c.name).join(', '));

        console.log('Ensuring "documents" collection exists...');
        await ensureCollection();
        console.log('Collection "documents" is ready.');
    } catch (error) {
        console.error('Failed to connect to Qdrant:', error);
        process.exit(1);
    }
}

testQdrant();
