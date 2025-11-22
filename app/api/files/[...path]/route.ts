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
        // Decode the path segments and join them
        const decodedPath = path.map(segment => decodeURIComponent(segment)).join('/');
        // For Paperless paths, they come as a single encoded segment like "paperless:%2F%2F75"
        // We need to handle both cases: already has leading slash or needs one
        const filePath = decodedPath.startsWith('/') || decodedPath.startsWith('paperless:') 
            ? decodedPath 
            : '/' + decodedPath;

        // Get file metadata from database
        const fileRecord = await prisma.indexedFile.findUnique({
            where: { filePath },
        });

        if (!fileRecord) {
            return NextResponse.json({ error: 'File not found in index' }, { status: 404 });
        }

        // Check if this is a Paperless document
        if (fileRecord.source === 'paperless') {
            // Get Paperless settings
            const settings = await prisma.settings.findUnique({
                where: { id: 'singleton' }
            });

            // Fetch content from Paperless
            const { getPaperlessClient } = await import('@/lib/paperless');
            const client = await getPaperlessClient();
            
            if (!client || !fileRecord.paperlessId) {
                return NextResponse.json({ error: 'Paperless-ngx not configured' }, { status: 500 });
            }

            const content = await client.getDocumentContent(fileRecord.paperlessId);
            // Use external URL if available, otherwise fall back to API URL
            const displayUrl = settings?.paperlessExternalUrl || settings?.paperlessUrl || '';
            
            // Parse tags
            let tags: string[] = [];
            if (fileRecord.paperlessTags) {
                try {
                    tags = JSON.parse(fileRecord.paperlessTags);
                } catch (e) {
                    console.error('Error parsing tags:', e);
                }
            }

            return NextResponse.json({
                fileName: fileRecord.paperlessTitle || `Document ${fileRecord.paperlessId}`,
                filePath,
                fileType: 'paperless',
                content,
                source: 'paperless',
                paperlessId: fileRecord.paperlessId,
                paperlessUrl: `${displayUrl}/documents/${fileRecord.paperlessId}`,
                paperlessTags: tags,
                paperlessCorrespondent: fileRecord.paperlessCorrespondent,
                metadata: {
                    size: content.length,
                    lastModified: fileRecord.lastModified,
                    chunkCount: fileRecord.chunkCount,
                    lastIndexed: fileRecord.lastIndexed,
                },
            });
        }

        // Local file handling
        const { content } = await readFileContent(filePath);
        const stats = await fs.stat(filePath);

        return NextResponse.json({
            fileName: filePath.split('/').pop(),
            filePath,
            fileType: filePath.split('.').pop() || 'txt',
            content,
            source: 'local',
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
