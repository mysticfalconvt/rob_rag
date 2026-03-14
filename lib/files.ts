import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const pdf = require("pdf-parse");

export const SYSTEM_EXCLUDED_DIRS = [
  "node_modules", ".git", ".next", "temp_images", ".archive", "Custom_Docs"
];

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import mammoth from "mammoth";

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
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

export async function readFileContent(
  filePath: string,
): Promise<{ content: string; metadata: Record<string, any> }> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdf(dataBuffer);
    return { content: data.text, metadata: {} };
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return { content: result.value, metadata: {} };
  }

  if (ext === ".md" || ext === ".markdown") {
    const fileContent = await fs.readFile(filePath, "utf-8");
    const { content, data } = matter(fileContent);
    return { content, metadata: data };
  }

  // Check for supported text-based extensions
  const supportedExtensions = [
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".html",
    ".pdf",
    ".docx",
  ];
  if (!supportedExtensions.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  // Default to text
  const content = await fs.readFile(filePath, "utf-8");
  return { content, metadata: {} };
}

export async function processFile(filePath: string): Promise<ProcessedChunk[]> {
  const { content, metadata: extractedMetadata } =
    await readFileContent(filePath);
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

interface SyncedFilesConfig {
  excludeDirs?: string[];         // Legacy: name-based exclusions
  excludePaths?: string[];        // New: relative path-based exclusions from tree picker
  includeExtensions: string[];
  excludeExtensions: string[];
  maxFileSizeBytes: number;
  excludePathPatterns?: string[];
}

async function getSyncedFilesConfig(): Promise<SyncedFilesConfig | null> {
  try {
    const prisma = (await import("./prisma")).default;
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { syncedFilesConfig: true },
    });

    if (settings?.syncedFilesConfig) {
      return JSON.parse(settings.syncedFilesConfig);
    }
  } catch (e) {
    console.error("Failed to load synced files config:", e);
  }
  return null;
}

interface ResolvedScanConfig {
  rootDir: string;
  supportedExtensions: string[];
  excludePaths: string[];
  legacyExcludeDirs: string[];
  excludeExtensions: string[];
  excludePathPatterns: string[];
  maxFileSize: number;
}

export async function getAllFiles(dirPath: string, _rootDir?: string): Promise<string[]> {
  // Load config once at the top level, then pass resolved config to recursive helper
  const rootDir = _rootDir || dirPath;

  if (!_rootDir) {
    const config = await getSyncedFilesConfig();

    let supportedExtensions = [
      ".txt", ".md", ".markdown", ".json", ".ts", ".tsx",
      ".js", ".jsx", ".css", ".html", ".pdf", ".docx",
    ];
    if (config?.includeExtensions && config.includeExtensions.length > 0) {
      supportedExtensions = config.includeExtensions;
    }

    const resolved: ResolvedScanConfig = {
      rootDir,
      supportedExtensions,
      excludePaths: config?.excludePaths || [],
      legacyExcludeDirs: config?.excludeDirs || [],
      excludeExtensions: config?.excludeExtensions || [],
      excludePathPatterns: config?.excludePathPatterns || [],
      maxFileSize: config?.maxFileSizeBytes || Number.MAX_SAFE_INTEGER,
    };

    return getAllFilesInternal(dirPath, resolved);
  }

  // Recursive calls should not reach here — this is a backward-compat path
  const resolved: ResolvedScanConfig = {
    rootDir,
    supportedExtensions: [".txt", ".md", ".markdown", ".json", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".pdf", ".docx"],
    excludePaths: [],
    legacyExcludeDirs: [],
    excludeExtensions: [],
    excludePathPatterns: [],
    maxFileSize: Number.MAX_SAFE_INTEGER,
  };
  return getAllFilesInternal(dirPath, resolved);
}

async function getAllFilesInternal(dirPath: string, cfg: ResolvedScanConfig): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(cfg.rootDir, fullPath);

    // Check if path contains any exclude patterns (case-insensitive)
    const shouldExcludePath = cfg.excludePathPatterns.some(pattern =>
      fullPath.toLowerCase().includes(pattern.toLowerCase())
    );

    if (shouldExcludePath) {
      console.log(`Skipping path matching pattern: ${fullPath}`);
      continue;
    }

    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;

      // System-excluded directories (always skipped)
      if (SYSTEM_EXCLUDED_DIRS.includes(entry.name)) {
        continue;
      }

      // Path-based user exclusions (new tree picker)
      const isPathExcluded = cfg.excludePaths.some(p =>
        relativePath === p || relativePath.startsWith(p + "/")
      );
      if (isPathExcluded) {
        console.log(`Skipping user-excluded path: ${relativePath}`);
        continue;
      }

      // Legacy name-based exclusions (backward compatibility)
      if (cfg.excludePaths.length === 0 && cfg.legacyExcludeDirs.includes(entry.name)) {
        console.log(`Skipping excluded directory: ${entry.name}`);
        continue;
      }

      files.push(...(await getAllFilesInternal(fullPath, cfg)));
    } else {
      if (entry.name.startsWith(".")) continue;

      const ext = path.extname(entry.name).toLowerCase();

      if (cfg.excludeExtensions.includes(ext)) {
        continue;
      }

      if (!cfg.supportedExtensions.includes(ext)) {
        continue;
      }

      try {
        const stats = await fs.stat(fullPath);
        if (stats.size > cfg.maxFileSize) {
          console.log(`Skipping large file (${Math.round(stats.size / 1024 / 1024)}MB): ${fullPath}`);
          continue;
        }
      } catch (e) {
        console.error(`Failed to check file size for ${fullPath}:`, e);
      }

      files.push(fullPath);
    }
  }

  return files;
}

export async function processPaperlessDocument(
  content: string,
  metadata: {
    id: number;
    title: string;
    tags: string[];
    correspondent: string | null;
    created: Date;
    modified: Date;
  },
): Promise<ProcessedChunk[]> {
  const fileHash = crypto
    .createHash("sha256")
    .update(content + metadata.modified.toISOString())
    .digest("hex");

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 200,
  });

  const chunks = await splitter.createDocuments([content]);

  const filePath = `paperless://${metadata.id}`;

  return chunks.map((chunk, index) => ({
    content: chunk.pageContent,
    metadata: {
      filePath,
      fileName: metadata.title,
      fileType: "paperless",
      parentFolder: "paperless",
      chunkIndex: index,
      totalChunks: chunks.length,
      fileHash,
      source: "paperless",
      paperlessId: metadata.id,
      paperlessTags: Array.isArray(metadata.tags)
        ? metadata.tags.join("|")
        : "",
      paperlessCorrespondent: metadata.correspondent || "",
      paperlessCreated: metadata.created.toISOString(),
      paperlessModified: metadata.modified.toISOString(),
    },
  }));
}
