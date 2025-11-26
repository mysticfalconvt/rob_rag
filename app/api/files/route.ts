import fs from "node:fs/promises";
import { type NextRequest, NextResponse } from "next/server";
import { deleteFileIndex, indexFile } from "@/lib/indexer";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";
import { requireCsrf } from "@/lib/csrf";

export async function GET(req: NextRequest) {
  try {
    // Require authentication to view files
    await requireAuth(req);
    const files = await prisma.indexedFile.findMany({
      orderBy: { lastIndexed: "desc" },
    });

    // Check if files need re-indexing (only for local files)
    const filesWithStatus = await Promise.all(
      files.map(async (file) => {
        // Skip file system check for Paperless-ngx documents
        if (file.source === "paperless") {
          return { ...file, needsReindexing: false };
        }

        try {
          const stats = await fs.stat(file.filePath);
          const lastModified = stats.mtime;
          const needsReindexing = lastModified > file.lastIndexed;
          return { ...file, needsReindexing };
        } catch (_error) {
          // File might have been deleted
          return { ...file, needsReindexing: false, fileMissing: true };
        }
      }),
    );

    // Also fetch Goodreads books
    const goodreadsBooks = await prisma.goodreadsBook.findMany({
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Transform books to match IndexedFile interface
    const booksAsFiles = goodreadsBooks.map((book) => ({
      id: book.id,
      filePath: `goodreads://${book.userId}/${book.id}`,
      chunkCount: 1, // Each book is one chunk
      lastIndexed: book.updatedAt.toISOString(),
      status: "indexed",
      source: "goodreads",
      needsReindexing: false,
      // Add book-specific fields
      goodreadsTitle: book.title,
      goodreadsAuthor: book.author,
      goodreadsRating: book.userRating,
      userName: book.user.name,
    }));

    return NextResponse.json([...filesWithStatus, ...booksAsFiles]);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching files:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireCsrf(req);
    await requireAuth(req);
    const { filePath } = await req.json();

    if (!filePath) {
      return NextResponse.json({ error: "Missing filePath" }, { status: 400 });
    }

    await indexFile(filePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("CSRF")) {
        return NextResponse.json(
          { error: "CSRF validation failed" },
          { status: 403 },
        );
      }
    }
    console.error("Error re-indexing file:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireCsrf(req);
    const session = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 },
      );
    }

    // Check if this is a Paperless-ngx document or Goodreads book
    const isPaperless = filePath.startsWith("paperless://");
    const isGoodreads = filePath.startsWith("goodreads://");

    // Check ownership for user-uploaded files
    const fileRecord = await prisma.indexedFile.findUnique({
      where: { filePath },
      select: { uploadedBy: true, source: true },
    });

    if (fileRecord) {
      const isAdmin = session.user.role === "admin";
      const isOwner = fileRecord.uploadedBy === session.user.id;
      const isUserUpload = fileRecord.source === "uploaded";

      // Permission check:
      // - Admins can delete anything
      // - Users can only delete their own uploads
      // - Synced/Paperless/Goodreads files require admin
      if (!isAdmin && (!isUserUpload || !isOwner)) {
        return NextResponse.json(
          { error: "Forbidden: You can only delete your own uploaded files" },
          { status: 403 },
        );
      }
    }

    // Delete from index
    await deleteFileIndex(filePath);

    // Delete from disk ONLY if it is a local file in the "File Uploads" directory
    // Paperless-ngx documents are never deleted from disk
    if (!isPaperless && filePath.includes("/File Uploads/")) {
      try {
        await fs.unlink(filePath);
        console.log(`Deleted file from disk: ${filePath}`);
      } catch (err: any) {
        if (err.code === "ENOENT") {
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
        ? "Paperless-ngx document removed from index"
        : "File deleted successfully",
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("CSRF")) {
        return NextResponse.json(
          { error: "CSRF validation failed" },
          { status: 403 },
        );
      }
    }
    console.error("Error deleting file:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
