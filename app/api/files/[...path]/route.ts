import fs from "node:fs/promises";
import { type NextRequest, NextResponse } from "next/server";
import { readFileContent } from "@/lib/files";
import prisma from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    // Decode the path segments and join them
    const decodedPath = path
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    // For Paperless, Goodreads, and Uploaded OCR paths, they come as a single encoded segment
    // We need to handle both cases: already has leading slash or needs one
    const filePath =
      decodedPath.startsWith("/") ||
      decodedPath.startsWith("paperless:") ||
      decodedPath.startsWith("goodreads:") ||
      decodedPath.startsWith("uploaded:")
        ? decodedPath
        : `/${decodedPath}`;

    // Check if this is a Goodreads book
    if (filePath.startsWith("goodreads://")) {
      // Extract userId and bookId from path: goodreads://userId/bookId
      const parts = filePath.replace("goodreads://", "").split("/");
      if (parts.length !== 2) {
        return NextResponse.json(
          { error: "Invalid Goodreads path format" },
          { status: 400 },
        );
      }

      const [userId, bookId] = parts;

      // Fetch book from database
      const book = await prisma.goodreadsBook.findUnique({
        where: { id: bookId },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      if (!book) {
        return NextResponse.json({ error: "Book not found" }, { status: 404 });
      }

      // Parse shelves
      let shelves: string[] = [];
      if (book.shelves) {
        try {
          shelves = JSON.parse(book.shelves);
        } catch (e) {
          // Fallback for comma-separated format
          shelves = book.shelves
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }

      // Parse read dates
      let readDates: string[] = [];
      if (book.readDates) {
        try {
          readDates = JSON.parse(book.readDates);
        } catch (e) {
          console.error("Error parsing readDates:", e);
        }
      }

      // Format book content as markdown
      const content = `# ${book.title}

**Author:** ${book.author}${book.additionalAuthors ? ` (with ${book.additionalAuthors})` : ""}

${book.userRating ? `**My Rating:** ${"⭐".repeat(book.userRating)}` : ""}

${book.averageRating ? `**Average Rating:** ${book.averageRating.toFixed(2)} / 5` : ""}

${readDates.length > 0 ? `**Read Dates:** ${readDates.map((d) => new Date(d).toLocaleDateString()).join(", ")}` : book.dateRead ? `**Date Read:** ${new Date(book.dateRead).toLocaleDateString()}` : ""}

${book.dateAdded ? `**Date Added:** ${new Date(book.dateAdded).toLocaleDateString()}` : ""}

${book.readCount && book.readCount > 1 ? `**Read Count:** ${book.readCount} times` : ""}

${shelves.length > 0 ? `**Shelves:** ${shelves.join(", ")}` : ""}

${book.pages ? `**Pages:** ${book.pages}` : ""}

${book.yearPublished ? `**Year Published:** ${book.yearPublished}` : ""}

${book.isbn ? `**ISBN:** ${book.isbn}` : ""}

${book.isbn13 ? `**ISBN13:** ${book.isbn13}` : ""}

${book.goodreadsBookId ? `**Goodreads Book ID:** ${book.goodreadsBookId}` : ""}

${book.reviewText ? `## My Review\n\n${book.reviewText}` : ""}

${book.privateNotes ? `## Private Notes\n\n${book.privateNotes}` : ""}

---

*From ${book.user.name}'s Goodreads library*`;

      // Get file ID and tags for this Goodreads book
      const fileRecord = await prisma.indexedFile.findUnique({
        where: { filePath },
        include: {
          documentTags: {
            include: { tag: true },
          },
        },
      });

      return NextResponse.json({
        fileId: fileRecord?.id,
        fileName: book.title,
        filePath,
        fileType: "goodreads",
        content,
        source: "goodreads",
        goodreadsBookId: book.goodreadsBookId,
        tags: fileRecord?.documentTags.map((dt) => ({
          id: dt.tag.id,
          name: dt.tag.name,
          status: dt.tag.status,
          color: dt.tag.color,
        })) || [],
        metadata: {
          author: book.author,
          rating: book.userRating,
          dateRead: book.dateRead,
          dateAdded: book.dateAdded,
          shelves,
          userName: book.user.name,
          chunkCount: 1,
          lastIndexed: book.updatedAt,
        },
      });
    }

    // Get file metadata from database
    const fileRecord = await prisma.indexedFile.findUnique({
      where: { filePath },
      include: {
        documentTags: {
          include: { tag: true },
        },
      },
    });

    if (!fileRecord) {
      return NextResponse.json(
        { error: "File not found in index" },
        { status: 404 },
      );
    }

    // Check if this is a Paperless or Custom OCR document
    if (fileRecord.source === "paperless" || fileRecord.source === "custom_ocr") {
      // If this is a custom OCR document, use the custom OCR output
      if (fileRecord.source === "custom_ocr" && fileRecord.ocrOutputPath && fileRecord.customOcrStatus === "completed") {
        try {
          const ocrContent = await fs.readFile(fileRecord.ocrOutputPath, "utf-8");

          // Get Paperless settings for URL
          const settings = await prisma.settings.findUnique({
            where: { id: "singleton" },
          });
          const displayUrl =
            settings?.paperlessExternalUrl || settings?.paperlessUrl || "";

          // Parse tags
          let tags: string[] = [];
          if (fileRecord.paperlessTags) {
            try {
              tags = JSON.parse(fileRecord.paperlessTags);
            } catch (e) {
              console.error("Error parsing tags:", e);
            }
          }

          // Parse extracted tags
          let extractedTags: string[] = [];
          if (fileRecord.extractedTags) {
            extractedTags = fileRecord.extractedTags.split("|").filter(Boolean);
          }

          return NextResponse.json({
            fileId: fileRecord.id,
            fileName: fileRecord.paperlessTitle || filePath.split('/').pop() || "Untitled Document",
            filePath,
            fileType: "md",
            content: ocrContent,
            source: "custom_ocr",
            paperlessId: fileRecord.paperlessId,
            paperlessUrl: displayUrl && fileRecord.paperlessId
              ? `${displayUrl}/documents/${fileRecord.paperlessId}`
              : undefined,
            tags: fileRecord.documentTags.map((dt) => ({
              id: dt.tag.id,
              name: dt.tag.name,
              status: dt.tag.status,
              color: dt.tag.color,
            })),
            metadata: {
              size: ocrContent.length,
              lastModified: fileRecord.lastModified,
              chunkCount: fileRecord.chunkCount,
              lastIndexed: fileRecord.lastIndexed,
              extractedDate: fileRecord.extractedDate,
              extractedTags,
              documentType: fileRecord.documentType,
              documentSummary: fileRecord.documentSummary,
              originalDocPath: fileRecord.originalDocPath,
            },
            paperlessTags: tags,
            paperlessCorrespondent: fileRecord.paperlessCorrespondent,
          });
        } catch (error) {
          console.error("Error reading OCR output:", error);
          // Fall through to regular paperless content
        }
      }

      // Get Paperless settings
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
      });

      // Fetch content from Paperless
      const { getPaperlessClient } = await import("@/lib/paperless");
      const client = await getPaperlessClient();

      if (!client || !fileRecord.paperlessId) {
        return NextResponse.json(
          { error: "Paperless-ngx not configured" },
          { status: 500 },
        );
      }

      const content = await client.getDocumentContent(fileRecord.paperlessId);
      // Use external URL if available, otherwise fall back to API URL
      const displayUrl =
        settings?.paperlessExternalUrl || settings?.paperlessUrl || "";

      // Parse tags
      let tags: string[] = [];
      if (fileRecord.paperlessTags) {
        try {
          tags = JSON.parse(fileRecord.paperlessTags);
        } catch (e) {
          console.error("Error parsing tags:", e);
        }
      }

      return NextResponse.json({
        fileId: fileRecord.id,
        fileName:
          fileRecord.paperlessTitle || `Document ${fileRecord.paperlessId}`,
        filePath,
        fileType: "paperless",
        content,
        source: "paperless",
        paperlessId: fileRecord.paperlessId,
        paperlessUrl: `${displayUrl}/documents/${fileRecord.paperlessId}`,
        paperlessTags: tags,
        paperlessCorrespondent: fileRecord.paperlessCorrespondent,
        tags: fileRecord.documentTags.map((dt) => ({
          id: dt.tag.id,
          name: dt.tag.name,
          status: dt.tag.status,
          color: dt.tag.color,
        })),
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
      fileId: fileRecord.id,
      fileName: filePath.split("/").pop(),
      filePath,
      fileType: filePath.split(".").pop() || "txt",
      content,
      source: "local",
      tags: fileRecord.documentTags.map((dt) => ({
        id: dt.tag.id,
        name: dt.tag.name,
        status: dt.tag.status,
        color: dt.tag.color,
      })),
      metadata: {
        size: stats.size,
        lastModified: stats.mtime,
        chunkCount: fileRecord.chunkCount,
        lastIndexed: fileRecord.lastIndexed,
      },
    });
  } catch (error) {
    console.error("Error fetching file:", error);
    return NextResponse.json(
      { error: "Failed to fetch file" },
      { status: 500 },
    );
  }
}
