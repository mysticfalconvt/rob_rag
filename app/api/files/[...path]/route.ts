import { NextRequest, NextResponse } from 'next/server';
import { readFileContent } from '@/lib/files';
import prisma from '@/lib/prisma';
import fs from 'fs/promises';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path } = await params;
        const filePath = '/' + path.join('/');

        // Get file metadata from database
        const fileRecord = await prisma.indexedFile.findUnique({
            where: { filePath },
        });

        if (!fileRecord) {
            return NextResponse.json({ error: 'File not found in index' }, { status: 404 });
        }

        // Read file content
        const { content } = await readFileContent(filePath);

        // Get file stats
        const stats = await fs.stat(filePath);

        return NextResponse.json({
            fileName: filePath.split('/').pop(),
            filePath,
            fileType: filePath.split('.').pop() || 'txt',
            content,
            metadata: {
                size: stats.size,
                lastModified: stats.mtime,
                chunkCount: fileRecord.chunkCount,
                lastIndexed: fileRecord.lastIndexed,
            },
        });
    } catch (error) {
        console.error('Error fetching file:', error);
        return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 });
    }
}
