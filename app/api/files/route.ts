import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deleteFileIndex } from '@/lib/indexer';

export async function GET() {
    try {
        const files = await prisma.indexedFile.findMany({
            orderBy: { lastIndexed: 'desc' },
        });
        return NextResponse.json(files);
    } catch (error) {
        console.error('Error fetching files:', error);
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

        await deleteFileIndex(filePath);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting file:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
