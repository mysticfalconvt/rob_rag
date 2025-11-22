import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { scanAllFiles } from '@/lib/indexer';
import { qdrantClient, COLLECTION_NAME } from '@/lib/qdrant';

export async function POST() {
    try {
        console.log('⚠️  Force reindex requested - clearing index database...');

        // Delete all records from IndexedFile table
        await prisma.indexedFile.deleteMany({});
        console.log('✅ Cleared IndexedFile table.');

        // Delete and recreate Qdrant collection to clear all vectors
        try {
            await qdrantClient.deleteCollection(COLLECTION_NAME);
            console.log('✅ Deleted Qdrant collection.');
        } catch (error) {
            console.log('Collection might not exist, continuing...');
        }

        console.log('Running full re-scan...');
        const result = await scanAllFiles();

        return NextResponse.json({
            success: true,
            message: 'Re-indexing complete',
            ...result
        });
    } catch (error) {
        console.error('Error during force reindex:', error);
        return NextResponse.json(
            { error: 'Failed to reindex files', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
