import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';
const pdf = require('pdf-parse');
import mammoth from 'mammoth';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export interface ProcessedChunk {
    content: string;
    metadata: FileMetadata;
}

export interface FileMetadata {
    filePath: string;
    fileName: string;
    fileType: string;
    parentFolder: string;
    chunkIndex: number;
    totalChunks: number;
    fileHash: string;
    [key: string]: any;
}

export async function getFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

export async function readFileContent(filePath: string): Promise<{ content: string; metadata: Record<string, any> }> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
        const dataBuffer = await fs.readFile(filePath);
        const data = await pdf(dataBuffer);
        return { content: data.text, metadata: {} };
    }

    if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        return { content: result.value, metadata: {} };
    }

    if (ext === '.md' || ext === '.markdown') {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const { content, data } = matter(fileContent);
        return { content, metadata: data };
    }

    // Check for supported text-based extensions
    const supportedExtensions = ['.txt', '.md', '.markdown', '.json', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.pdf', '.docx'];
    if (!supportedExtensions.includes(ext)) {
        throw new Error(`Unsupported file type: ${ext}`);
    }

    // Default to text
    const content = await fs.readFile(filePath, 'utf-8');
    return { content, metadata: {} };
}

export async function processFile(filePath: string): Promise<ProcessedChunk[]> {
    const { content, metadata: extractedMetadata } = await readFileContent(filePath);
    const fileHash = await getFileHash(filePath);

    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 200,
    });

    const chunks = await splitter.createDocuments([content]);

    const fileName = path.basename(filePath);
    const parentFolder = path.basename(path.dirname(filePath));
    const fileType = path.extname(filePath).substring(1);

    return chunks.map((chunk, index) => ({
        content: chunk.pageContent,
        metadata: {
            filePath,
            fileName,
            fileType,
            parentFolder,
            chunkIndex: index,
            totalChunks: chunks.length,
            fileHash,
            ...extractedMetadata,
        },
    }));
}

export async function getAllFiles(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];
    const supportedExtensions = ['.txt', '.md', '.markdown', '.json', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.pdf', '.docx'];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue; // Skip dot folders
            files.push(...(await getAllFiles(fullPath)));
        } else {
            if (entry.name.startsWith('.')) continue; // Skip dot files

            const ext = path.extname(entry.name).toLowerCase();
            if (supportedExtensions.includes(ext)) {
                files.push(fullPath);
            }
        }
    }

    return files;
}
