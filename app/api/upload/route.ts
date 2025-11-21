import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { indexFile } from '@/lib/indexer';
import { config } from '@/lib/config';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const uploadDir = path.join(config.DOCUMENTS_FOLDER_PATH, 'File Uploads');

        // Ensure filename is safe
        const filename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filePath = path.join(uploadDir, filename);

        await writeFile(filePath, buffer);
        console.log(`File saved to ${filePath}`);

        // Index the new file
        await indexFile(filePath);

        return NextResponse.json({ success: true, filePath });
    } catch (error) {
        console.error('Error uploading file:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
