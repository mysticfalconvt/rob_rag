import prisma from "./prisma";
import { syncCalendarEvents, indexCalendarEvents } from "./googleCalendar";
import { scanPaperlessDocuments } from "./indexer";
import { parseGoodreadsRSS, importBooksForUser, indexGoodreadsBooks } from "./goodreads";
import { refreshGmailTokens } from "./email/gmailProvider";
import { EmailAccountData } from "./email/types";

interface SyncResult {
  calendar: number;
  goodreads: number;
  paperless: number;
}

/**
 * Unified function to sync all data sources
 * Called by:
 * - Manual "Sync Now" button in UI
 * - Daily scheduled sync
 */
export async function syncAllDataSources(): Promise<SyncResult> {
  const result: SyncResult = {
    calendar: 0,
    goodreads: 0,
    paperless: 0,
  };

  const errors: string[] = [];

  // 1. Sync Google Calendar
  try {
    console.log("[Sync All] Syncing Google Calendar...");
    await syncCalendarEvents();
    const indexed = await indexCalendarEvents(true); // Incremental sync
    result.calendar = indexed;
    console.log(`[Sync All] Calendar: ${indexed} events indexed`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Sync All] Google Calendar sync failed:", errorMsg);
    errors.push(`Calendar: ${errorMsg}`);
  }

  // 2. Sync Goodreads
  try {
    console.log("[Sync All] Syncing Goodreads...");
    let totalIndexed = 0;

    const users = await prisma.goodreadsUser.findMany({
      include: {
        goodreadsSources: true,
      },
    });

    for (const user of users) {
      if (user.goodreadsSources) {
        try {
          const response = await fetch(user.goodreadsSources.rssFeedUrl);
          if (response.ok) {
            const rssContent = await response.text();
            const books = await parseGoodreadsRSS(rssContent);
            await importBooksForUser(user.id, books);

            // Update last synced
            await prisma.goodreadsSource.update({
              where: { id: user.goodreadsSources.id },
              data: { lastSyncedAt: new Date() },
            });

            // Index books for this user
            const indexed = await indexGoodreadsBooks(user.id);
            totalIndexed += indexed;
          }
        } catch (error) {
          console.error(`[Sync All] Error syncing Goodreads for ${user.name}:`, error);
        }
      }
    }

    result.goodreads = totalIndexed;
    console.log(`[Sync All] Goodreads: ${totalIndexed} books indexed`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Sync All] Goodreads sync failed:", errorMsg);
    errors.push(`Goodreads: ${errorMsg}`);
  }

  // 3. Sync Paperless
  try {
    console.log("[Sync All] Syncing Paperless...");
    const paperlessResult = await scanPaperlessDocuments();
    result.paperless = paperlessResult.indexedCount;
    console.log(`[Sync All] Paperless: ${paperlessResult.indexedCount} documents indexed`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Sync All] Paperless sync failed:", errorMsg);
    errors.push(`Paperless: ${errorMsg}`);
  }

  // 4. Refresh Gmail tokens (keeps tokens fresh for on-demand queries)
  try {
    console.log("[Sync All] Refreshing Gmail tokens...");
    const gmailAccounts = await prisma.emailAccount.findMany({
      where: { provider: "gmail", enabled: true, gmailRefreshToken: { not: null } },
    });

    let refreshed = 0;
    for (const account of gmailAccounts) {
      const success = await refreshGmailTokens(account as EmailAccountData);
      if (success) refreshed++;
    }
    console.log(`[Sync All] Gmail tokens: ${refreshed}/${gmailAccounts.length} refreshed`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Sync All] Gmail token refresh failed:", errorMsg);
    errors.push(`Gmail tokens: ${errorMsg}`);
  }

  // Update last sync status in database
  const now = new Date();
  const status = errors.length === 0 ? "success" : "failed";
  const errorMessage = errors.length > 0 ? errors.join("; ") : null;

  await prisma.settings.update({
    where: { id: "singleton" },
    data: {
      dailySyncLastRun: now,
      dailySyncLastStatus: status,
      dailySyncLastError: errorMessage,
    },
  });

  console.log(`[Sync All] Complete. Status: ${status}`);

  return result;
}
