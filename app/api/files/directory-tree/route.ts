import fs from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { config } from "@/lib/config";
import { SYSTEM_EXCLUDED_DIRS } from "@/lib/files";

interface DirectoryNode {
  name: string;
  path: string;
  children: DirectoryNode[];
  fileCount: number;
  isSystemExcluded: boolean;
}

const SUPPORTED_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".json", ".ts", ".tsx",
  ".js", ".jsx", ".css", ".html", ".pdf", ".docx",
];

async function buildTree(
  dirPath: string,
  rootDir: string,
  depth: number,
  maxDepth: number,
): Promise<DirectoryNode[]> {
  if (depth >= maxDepth) return [];

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: DirectoryNode[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootDir, fullPath);
    const isSystemExcluded = SYSTEM_EXCLUDED_DIRS.includes(entry.name);

    // Count indexable files in this directory (non-recursive, just immediate)
    let fileCount = 0;
    try {
      const children = await fs.readdir(fullPath, { withFileTypes: true });
      fileCount = children.filter(c =>
        !c.isDirectory() &&
        !c.name.startsWith(".") &&
        SUPPORTED_EXTENSIONS.includes(path.extname(c.name).toLowerCase())
      ).length;
    } catch {
      // ignore permission errors
    }

    // Don't recurse into system-excluded dirs
    const childNodes = isSystemExcluded
      ? []
      : await buildTree(fullPath, rootDir, depth + 1, maxDepth);

    nodes.push({
      name: entry.name,
      path: relativePath,
      children: childNodes,
      fileCount,
      isSystemExcluded,
    });
  }

  // Sort alphabetically
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const { searchParams } = new URL(req.url);
    const maxDepth = Math.min(parseInt(searchParams.get("depth") || "5", 10), 10);

    const rootDir = config.DOCUMENTS_FOLDER_PATH;

    // Verify root exists
    try {
      await fs.access(rootDir);
    } catch {
      return NextResponse.json(
        { error: "Documents folder not found", path: rootDir },
        { status: 404 },
      );
    }

    const tree = await buildTree(rootDir, rootDir, 0, maxDepth);

    // Also count files in the root directory itself
    let rootFileCount = 0;
    try {
      const rootEntries = await fs.readdir(rootDir, { withFileTypes: true });
      rootFileCount = rootEntries.filter(c =>
        !c.isDirectory() &&
        !c.name.startsWith(".") &&
        SUPPORTED_EXTENSIONS.includes(path.extname(c.name).toLowerCase())
      ).length;
    } catch {
      // ignore
    }

    return NextResponse.json({
      rootPath: rootDir,
      rootFileCount,
      children: tree,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error building directory tree:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
