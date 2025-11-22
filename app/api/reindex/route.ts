import { NextResponse } from "next/server";
import { scanAllFiles } from "@/lib/indexer";
import prisma from "@/lib/prisma";
import { COLLECTION_NAME, qdrantClient } from "@/lib/qdrant";

export async function POST() {
  try {
    console.log("⚠️  Force reindex requested - clearing index database...");

    // Delete all records from IndexedFile table
    await prisma.indexedFile.deleteMany({});
    console.log("✅ Cleared IndexedFile table.");

    // Delete and recreate Qdrant collection to clear all vectors
    try {
      await qdrantClient.deleteCollection(COLLECTION_NAME);
      console.log("✅ Deleted Qdrant collection.");
    } catch (_error) {
      console.log("Collection might not exist, continuing...");
    }

    console.log("Running full re-scan...");
    const result = await scanAllFiles();

    // Also reindex Goodreads books
    console.log("Re-indexing Goodreads books...");
    let goodreadsCount = 0;
    try {
      const { indexGoodreadsBooks } = await import("@/lib/goodreads");
      const users = await prisma.user.findMany();

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
