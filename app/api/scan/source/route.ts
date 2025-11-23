import { NextRequest, NextResponse } from "next/server";
import { scanAllFiles, scanPaperlessDocuments } from "@/lib/indexer";
import prisma from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const { source } = await request.json();

    if (!source) {
      return NextResponse.json(
        { error: "Source parameter is required" },
        { status: 400 },
      );
    }

    let result;
    let message = "";

    switch (source) {
      case "local": {
        // Scan local files only
        const allFilesResult = await scanAllFiles();
        result = {
          indexed: allFilesResult.localIndexed,
          deleted: allFilesResult.localDeleted,
        };
        message = `Scanned local files: ${result.indexed} indexed, ${result.deleted} deleted`;
        break;
      }

      case "paperless": {
        // Scan Paperless documents only
        const paperlessResult = await scanPaperlessDocuments();
        result = {
          indexed: paperlessResult.indexedCount,
          deleted: paperlessResult.deletedCount,
        };
        message = `Scanned Paperless: ${result.indexed} indexed, ${result.deleted} deleted`;
        break;
      }

      case "goodreads": {
        // Scan and index all Goodreads books
        // First, sync RSS feeds for all users with configured feeds
        let totalSynced = 0;
        let goodreadsCount = 0;
        const { indexGoodreadsBooks, parseGoodreadsRSS, importBooksForUser } =
          await import("@/lib/goodreads");

        const users = await prisma.user.findMany({
          include: {
            goodreadsSources: true,
            _count: {
              select: { goodreadsBooks: true },
            },
          },
        });

        console.log(`[Goodreads Scan] Found ${users.length} users to process`);

        // Step 1: Sync RSS feeds for users that have them configured
        for (const user of users) {
          if (user.goodreadsSources.length > 0) {
            const source = user.goodreadsSources[0];
            try {
              console.log(`[Goodreads Scan] Syncing RSS feed for ${user.name}`);
              const response = await fetch(source.rssFeedUrl);
              if (response.ok) {
                const rssContent = await response.text();
                const books = await parseGoodreadsRSS(rssContent);
                const syncResult = await importBooksForUser(user.id, books);
                totalSynced += syncResult.created + syncResult.updated;
                console.log(
                  `[Goodreads Scan] Synced ${books.length} books for ${user.name} (${syncResult.created} new, ${syncResult.updated} updated)`,
                );

                // Update last synced time
                await prisma.goodreadsSource.update({
                  where: { id: source.id },
                  data: { lastSyncedAt: new Date() },
                });
              } else {
                console.warn(
                  `[Goodreads Scan] Failed to fetch RSS feed for ${user.name}: ${response.status}`,
                );
              }
            } catch (error) {
              console.error(
                `[Goodreads Scan] Error syncing RSS for ${user.name}:`,
                error,
              );
            }
          }
        }

        // Step 2: Re-fetch users with updated book counts
        const updatedUsers = await prisma.user.findMany({
          include: {
            _count: {
              select: { goodreadsBooks: true },
            },
          },
        });

        // Step 3: Index all books
        for (const user of updatedUsers) {
          console.log(
            `[Goodreads Scan] Indexing ${user._count.goodreadsBooks} books for ${user.name}`,
          );
          const count = await indexGoodreadsBooks(user.id);
          goodreadsCount += count;
          console.log(`✅ Indexed ${count} books for ${user.name}`);
        }

        result = { indexed: goodreadsCount, deleted: 0, synced: totalSynced };
        message = `Scanned Goodreads: Synced ${totalSynced} books, indexed ${goodreadsCount} books from ${users.length} users`;
        break;
      }

      case "uploaded": {
        // Scan uploaded files only (files in File Uploads folder)
        const { getAllFiles } = await import("@/lib/files");
        const { config } = await import("@/lib/config");
        const { indexFile } = await import("@/lib/indexer");
        const path = await import("path");

        const allFiles = await getAllFiles(config.DOCUMENTS_FOLDER_PATH);
        const uploadedFiles = allFiles.filter((f) =>
          f.includes("/File Uploads/"),
        );

        let indexed = 0;
        for (const filePath of uploadedFiles) {
          try {
            await indexFile(filePath);
            indexed++;
          } catch (error) {
            console.error(`Failed to index ${filePath}:`, error);
          }
        }

        // Remove deleted uploaded files from index
        const dbFiles = await prisma.indexedFile.findMany({
          where: { source: "uploaded" },
          select: { filePath: true },
        });

        let deleted = 0;
        const { deleteFileIndex } = await import("@/lib/indexer");
        for (const dbFile of dbFiles) {
          if (!allFiles.includes(dbFile.filePath)) {
            try {
              await deleteFileIndex(dbFile.filePath);
              deleted++;
            } catch (error) {
              console.error(
                `Failed to delete index for ${dbFile.filePath}:`,
                error,
              );
            }
          }
        }

        result = { indexed, deleted };
        message = `Scanned uploaded files: ${indexed} indexed, ${deleted} deleted`;
        break;
      }

      default:
        return NextResponse.json(
          {
            error: `Invalid source: ${source}. Valid sources: local, uploaded, paperless, goodreads`,
          },
          { status: 400 },
        );
    }

    return NextResponse.json({
      success: true,
      message,
      ...result,
    });
  } catch (error) {
    console.error("Error scanning by source:", error);
    return NextResponse.json(
      {
        error: "Failed to scan",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
