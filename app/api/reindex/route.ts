import { NextRequest, NextResponse } from "next/server";
import { scanAllFiles } from "@/lib/indexer";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    // Only admins can force reindex
    await requireAdmin(req);
    console.log("⚠️  Force reindex requested - clearing index database...");

    // Delete all records from IndexedFile table
    await prisma.indexedFile.deleteMany({});
    console.log("✅ Cleared IndexedFile table.");

    // Delete all DocumentChunks (vectors)
    await prisma.documentChunk.deleteMany({});
    console.log("✅ Cleared DocumentChunk table (vectors).");

    console.log("Running full re-scan...");
    const result = await scanAllFiles();

    // Also reindex Goodreads books
    console.log("Re-indexing Goodreads books...");
    let goodreadsCount = 0;
    try {
      const { indexGoodreadsBooks } = await import("@/lib/goodreads");
      const users = await prisma.goodreadsUser.findMany();

      for (const user of users) {
        const count = await indexGoodreadsBooks(user.id);
        goodreadsCount += count;
        console.log(`✅ Indexed ${count} books for ${user.name}`);
      }
    } catch (error) {
      console.error("Error indexing Goodreads books:", error);
    }

    return NextResponse.json({
      success: true,
      message: "Re-indexing complete",
      ...result,
      goodreadsIndexed: goodreadsCount,
    });
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
    console.error("Error during force reindex:", error);
    return NextResponse.json(
      {
        error: "Failed to reindex files",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
