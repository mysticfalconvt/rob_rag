import './setup-env';
import { qdrantClient } from '../lib/qdrant';

async function recreateCollection() {
    console.log('Recreating documents collection...');

    try {
        // Delete existing collection
        console.log('Deleting old collection...');
        await qdrantClient.deleteCollection('documents');
        console.log('✓ Deleted\n');

        // Create new collection with correct dimensions
        console.log('Creating new collection with 256 dimensions...');
        await qdrantClient.createCollection('documents', {
            vectors: {
                size: 256,
                distance: 'Cosine',
            },
        });
        console.log('✓ Collection created successfully!');
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

recreateCollection();
