import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { qdrantClient } from '@/lib/qdrant';
import { config } from '@/lib/config';

export async function GET() {
    try {
        // 1. Check Qdrant
        let qdrantStatus = 'disconnected';
        try {
            await qdrantClient.getCollections();
            qdrantStatus = 'connected';
        } catch (e) {
            console.error('Qdrant check failed:', e);
        }

        // 2. Check LM Studio
        let lmStudioStatus = 'disconnected';
        try {
            const res = await fetch(`${config.LM_STUDIO_API_URL}/models`);
            if (res.ok) lmStudioStatus = 'connected';
        } catch (e) {
            console.error('LM Studio check failed:', e);
        }

        // 3. Get Stats
        const fileCount = await prisma.indexedFile.count();
        const chunkStats = await prisma.indexedFile.aggregate({
            _sum: { chunkCount: true },
        });

        return NextResponse.json({
            qdrant: qdrantStatus,
            lmStudio: lmStudioStatus,
            totalFiles: fileCount,
            totalChunks: chunkStats._sum.chunkCount || 0,
            config: {
                embeddingModel: config.EMBEDDING_MODEL_NAME,
                chatModel: config.CHAT_MODEL_NAME,
            },
        });
    } catch (error) {
        console.error('Error fetching status:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
