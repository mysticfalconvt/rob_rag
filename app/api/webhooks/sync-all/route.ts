import { NextRequest, NextResponse } from "next/server";
import { syncCalendarEvents, indexCalendarEvents } from "@/lib/googleCalendar";
import { importBooksForUser, indexGoodreadsBooks, parseGoodreadsRSS } from "@/lib/goodreads";
import { scanPaperlessDocuments } from "@/lib/indexer";
import { requireAdmin } from "@/lib/session";
import prisma from "@/lib/prisma";

/**
 * Webhook endpoint for scheduled syncing of all data sources
 *
 * Can be triggered by:
 * 1. External cron services (using WEBHOOK_SECRET)
 * 2. Internal UI (using session authentication)
 *
 * Security: Requires either webhook secret token OR admin session
 *
 * Usage (external):
 *   curl -X POST https://your-app.com/api/webhooks/sync-all \
 *     -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"sources": ["google-calendar", "goodreads", "paperless"]}'
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Verify authentication (webhook secret OR admin session)
    const authHeader = req.headers.get("authorization");
    const webhookSecret = process.env.WEBHOOK_SECRET;
    let isAuthenticated = false;

    // Try webhook secret first
    if (authHeader && webhookSecret) {
      const providedSecret = authHeader.replace("Bearer ", "");
      if (providedSecret === webhookSecret) {
        isAuthenticated = true;
      }
    }

    // If webhook auth failed, try session auth
    if (!isAuthenticated) {
      try {
        await requireAdmin(req);
        isAuthenticated = true;
      } catch (error) {
        // Session auth failed
      }
    }

    if (!isAuthenticated) {
      console.error("[Webhook] Unauthorized attempt");
      return NextResponse.json(
        { error: "Unauthorized - requires WEBHOOK_SECRET or admin session" },
        { status: 401 }
      );
    }

    // 2. Parse request body (optional source filtering)
    const body = await req.json().catch(() => ({}));
    const requestedSources = body.sources || ["google-calendar", "goodreads", "paperless"];

    console.log(`[Webhook] Starting sync for sources: ${requestedSources.join(", ")}`);

    const results: any = {
      timestamp: new Date().toISOString(),
      sources: {},
    };

    // 3. Sync Google Calendar
    if (requestedSources.includes("google-calendar")) {
      try {
        console.log("[Webhook] Syncing Google Calendar...");
        const syncResult = await syncCalendarEvents();
        const indexed = await indexCalendarEvents(true); // Incremental

        results.sources["google-calendar"] = {
          success: true,
          synced: syncResult,
          indexed,
        };
      } catch (error) {
        console.error("[Webhook] Google Calendar sync failed:", error);
        results.sources["google-calendar"] = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    // 4. Sync Goodreads
    if (requestedSources.includes("goodreads")) {
      try {
        console.log("[Webhook] Syncing Goodreads...");
        let totalSynced = 0;
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
                const syncResult = await importBooksForUser(user.id, books);
                totalSynced += syncResult.created + syncResult.updated;

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
              console.error(`[Webhook] Error syncing Goodreads for ${user.name}:`, error);
            }
          }
        }

        results.sources["goodreads"] = {
          success: true,
          users: users.length,
          synced: totalSynced,
          indexed: totalIndexed,
        };
      } catch (error) {
        console.error("[Webhook] Goodreads sync failed:", error);
        results.sources["goodreads"] = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    // 5. Sync Paperless
    if (requestedSources.includes("paperless")) {
      try {
        console.log("[Webhook] Syncing Paperless...");
        const paperlessResult = await scanPaperlessDocuments();

        results.sources["paperless"] = {
          success: true,
          indexed: paperlessResult.indexedCount,
          deleted: paperlessResult.deletedCount,
        };
      } catch (error) {
        console.error("[Webhook] Paperless sync failed:", error);
        results.sources["paperless"] = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    console.log("[Webhook] Sync complete:", JSON.stringify(results, null, 2));

    return NextResponse.json({
      success: true,
      message: "Sync completed",
      ...results,
    });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
