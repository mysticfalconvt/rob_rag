import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { indexFile, scanPaperlessDocuments } from "@/lib/indexer";
import { requireAdmin } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    // Only admins can reindex
    await requireAdmin(req);
    const { source } = await req.json();

    if (
      !source ||
      !["uploaded", "synced", "paperless", "goodreads"].includes(source)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid source. Must be: uploaded, synced, paperless, or goodreads",
        },
        { status: 400 },
      );
    }

    console.log(`🔄 Reindexing ${source} documents...`);

    if (source === "goodreads") {
      // Reindex Goodreads books
      const { indexGoodreadsBooks } = await import("@/lib/goodreads");
      const users = await prisma.goodreadsUser.findMany();

      let totalBooks = 0;
      for (const user of users) {
        // Force full reindex (onlyNew=false) since this is an explicit reindex request
        const count = await indexGoodreadsBooks(user.id, false);
        totalBooks += count;
        console.log(`✅ Indexed ${count} books for ${user.name}`);
      }

      return NextResponse.json({
        success: true,
        message: `Reindexed ${totalBooks} Goodreads books`,
        count: totalBooks,
      });
    } else if (source === "paperless") {
      // Reindex Paperless documents
      const result = await scanPaperlessDocuments();

      return NextResponse.json({
        success: true,
        message: `Reindexed Paperless documents`,
        ...result,
      });
    } else {
      // Reindex uploaded or synced files
      const files = await prisma.indexedFile.findMany({
        where: { source },
      });

      let indexed = 0;
      let failed = 0;

      for (const file of files) {
        try {
          await indexFile(file.filePath);
          indexed++;
        } catch (error) {
          console.error(`Failed to reindex ${file.filePath}:`, error);
          failed++;
        }
      }

      return NextResponse.json({
        success: true,
        message: `Reindexed ${indexed} ${source} files`,
        indexed,
        failed,
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "Forbidden: Admin access required" },
          { status: 403 },
        );
      }
    }
    console.error("Error during source reindex:", error);
    return NextResponse.json(
      {
        error: "Failed to reindex source",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
