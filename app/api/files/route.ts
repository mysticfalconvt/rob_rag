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
      include: {
        documentTags: {
          include: {
            tag: true,
          },
        },
      },
    });

    // Check if files need re-indexing (only for local files)
    // For Goodreads files, enrich with book metadata
    const filesWithStatus = await Promise.all(
      files.map(async (file) => {
        // Skip file system check for Paperless-ngx, Custom OCR, and Goodreads documents
        if (file.source === "paperless" || file.source === "custom_ocr" || file.source === "goodreads") {
          const result: any = {
            ...file,
            needsReindexing: false,
            tags: file.documentTags.map((dt) => dt.tag.name),
          };

          // Enrich Goodreads files with book metadata
          if (file.source === "goodreads") {
            const bookId = file.filePath.split("/").pop();
            if (bookId) {
              const book = await prisma.goodreadsBook.findUnique({
                where: { id: bookId },
                include: {
                  user: {
                    select: { name: true },
                  },
                },
              });
              if (book) {
                result.goodreadsTitle = book.title;
                result.goodreadsAuthor = book.author;
                result.goodreadsRating = book.userRating;
                result.userName = book.user.name;
              }
            }
          }

          return result;
        }

        try {
          const stats = await fs.stat(file.filePath);
          const lastModified = stats.mtime;
          const needsReindexing = lastModified > file.lastIndexed;
          return {
            ...file,
            needsReindexing,
            tags: file.documentTags.map((dt) => dt.tag.name),
          };
        } catch (_error) {
          // File might have been deleted
          return {
            ...file,
            needsReindexing: false,
            fileMissing: true,
            tags: file.documentTags.map((dt) => dt.tag.name),
          };
        }
      }),
    );

    return NextResponse.json(filesWithStatus);
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
    // TODO: Re-enable CSRF once frontend is updated to send tokens
    // await requireCsrf(req);
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
    // TODO: Re-enable CSRF once frontend is updated to send tokens
    // await requireCsrf(req);
    const session = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 },
      );
    }

    // Check if this is a Paperless-ngx document, Goodreads book, or uploaded OCR
    const isPaperless = filePath.startsWith("paperless://");
    const isGoodreads = filePath.startsWith("goodreads://");
    const isUploadedOcr = filePath.startsWith("uploaded://");

    // Check ownership for user-uploaded files
    const fileRecord = await prisma.indexedFile.findUnique({
      where: { filePath },
      select: { uploadedBy: true, source: true, originalDocPath: true, ocrOutputPath: true },
    });

    if (fileRecord) {
      const isAdmin = session.user.role === "admin";
      const isOwner = fileRecord.uploadedBy === session.user.id;
      const isUserUpload = fileRecord.source === "uploaded" || fileRecord.source === "custom_ocr";

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

    // Delete from disk based on file type
    if (isUploadedOcr && fileRecord) {
      // Delete uploaded OCR files (both original and markdown)
      try {
        if (fileRecord.originalDocPath) {
          await fs.unlink(fileRecord.originalDocPath);
          console.log(`Deleted original file from disk: ${fileRecord.originalDocPath}`);
        }
        if (fileRecord.ocrOutputPath) {
          await fs.unlink(fileRecord.ocrOutputPath);
          console.log(`Deleted OCR output from disk: ${fileRecord.ocrOutputPath}`);
        }
      } catch (err: any) {
        if (err.code === "ENOENT") {
          console.warn(`File not found on disk during delete`);
        } else {
          console.error(`Error deleting files from disk:`, err);
          // We don't fail the request if disk delete fails, but we log it
        }
      }
    } else if (!isPaperless && !isGoodreads && filePath.includes("/File Uploads/")) {
      // Delete regular uploaded text files
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
        : isGoodreads
        ? "Goodreads book removed from index"
        : "File deleted successfully",
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    console.error("Error deleting file:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
