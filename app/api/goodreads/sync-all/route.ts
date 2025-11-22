import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  parseGoodreadsRSS,
  importBooksForUser,
  indexGoodreadsBooks,
} from "@/lib/goodreads";

/**
 * Sync all RSS feeds for all users
 * This endpoint can be called by a cron job or scheduled task
 */
export async function POST(req: Request) {
  try {
    console.log("Starting Goodreads RSS sync for all users...");

    // Get all sources that need syncing
    const sources = await prisma.goodreadsSource.findMany({
      include: {
        user: true,
      },
    });

    if (sources.length === 0) {
      return NextResponse.json({ message: "No RSS feeds configured" });
    }

    const results = [];

    for (const source of sources) {
      try {
        console.log(`Syncing RSS feed for user: ${source.user.name}`);

        // Fetch RSS feed
        const response = await fetch(source.rssFeedUrl);
        if (!response.ok) {
          console.error(
            `Failed to fetch RSS feed for ${source.user.name}: ${response.status}`,
          );
          results.push({
            userId: source.userId,
            userName: source.user.name,
            success: false,
            error: `HTTP ${response.status}`,
          });
          continue;
        }

        const rssContent = await response.text();

        // Parse RSS
        const books = await parseGoodreadsRSS(rssContent);

        // Import books
        const importResult = await importBooksForUser(source.userId, books);

        // Generate RAG chunks
        const indexedCount = await indexGoodreadsBooks(source.userId);

        // Update last synced time
        await prisma.goodreadsSource.update({
          where: { id: source.id },
          data: { lastSyncedAt: new Date() },
        });

        results.push({
          userId: source.userId,
          userName: source.user.name,
          success: true,
          ...importResult,
          indexedCount,
        });

        console.log(
          `✅ Synced ${source.user.name}: Created ${importResult.created}, Updated ${importResult.updated}`,
        );
      } catch (error) {
        console.error(`Error syncing RSS for user ${source.user.name}:`, error);
        results.push({
          userId: source.userId,
          userName: source.user.name,
          success: false,
          error: (error as Error).message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    console.log(
      `Goodreads sync complete: ${successCount} succeeded, ${failedCount} failed`,
    );

    return NextResponse.json({
      success: true,
      totalSources: sources.length,
      successCount,
      failedCount,
      results,
    });
  } catch (error) {
    console.error("Error syncing all RSS feeds:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: (error as Error).message },
      { status: 500 },
    );
  }
}
