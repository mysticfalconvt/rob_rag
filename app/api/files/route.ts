import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deleteFileIndex, indexFile } from '@/lib/indexer';
import fs from 'fs/promises';

export async function GET() {
    try {
        const files = await prisma.indexedFile.findMany({
            orderBy: { lastIndexed: 'desc' },
        });

        // Check if files need re-indexing (only for local files)
        const filesWithStatus = await Promise.all(files.map(async (file) => {
            // Skip file system check for Paperless-ngx documents
            if (file.source === 'paperless') {
                return { ...file, needsReindexing: false };
            }

            try {
                const stats = await fs.stat(file.filePath);
                const lastModified = stats.mtime;
                const needsReindexing = lastModified > file.lastIndexed;
                return { ...file, needsReindexing };
            } catch (error) {
                // File might have been deleted
                return { ...file, needsReindexing: false, fileMissing: true };
            }
        }));

        return NextResponse.json(filesWithStatus);
    } catch (error) {
        console.error('Error fetching files:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { filePath } = await req.json();

        if (!filePath) {
            return NextResponse.json({ error: 'Missing filePath' }, { status: 400 });
        }

        await indexFile(filePath);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error re-indexing file:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const filePath = searchParams.get('path');

        if (!filePath) {
            return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
        }

        // Check if this is a Paperless-ngx document
        const isPaperless = filePath.startsWith('paperless://');

        // Delete from index
        await deleteFileIndex(filePath);

        // Delete from disk ONLY if it is a local file in the "File Uploads" directory
        // Paperless-ngx documents are never deleted from disk
        if (!isPaperless && filePath.includes('/File Uploads/')) {
            try {
                await fs.unlink(filePath);
                console.log(`Deleted file from disk: ${filePath}`);
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    console.warn(`File not found on disk: ${filePath}`);
                } else {
                    console.error(`Error deleting file from disk: ${filePath}`, err);
                    // We don't fail the request if disk delete fails, but we log it
                }
            }
        }

        return NextResponse.json({ 
            success: true,
            message: isPaperless 
                ? 'Paperless-ngx document removed from index' 
                : 'File deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting file:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
