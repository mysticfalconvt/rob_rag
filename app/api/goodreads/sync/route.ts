import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { parseGoodreadsRSS, importBooksForUser } from "@/lib/goodreads";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 },
      );
    }

    // Get RSS source
    const source = await prisma.goodreadsSource.findFirst({
      where: { userId },
    });

    if (!source) {
      return NextResponse.json(
        { error: "No RSS feed configured for this user" },
        { status: 404 },
      );
    }

    // Fetch RSS feed
    const response = await fetch(source.rssFeedUrl);
    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch RSS feed" },
        { status: response.status },
      );
    }

    const rssContent = await response.text();

    // Parse RSS
    const books = await parseGoodreadsRSS(rssContent);

    // Import books
    const result = await importBooksForUser(userId, books);

    // Update last synced time
    await prisma.goodreadsSource.update({
      where: { id: source.id },
      data: { lastSyncedAt: new Date() },
    });

    // Generate RAG chunks
    const { indexGoodreadsBooks } = await import("@/lib/goodreads");
    const indexedCount = await indexGoodreadsBooks(userId);

    return NextResponse.json({
      success: true,
      ...result,
      total: books.length,
      lastSyncedAt: new Date(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error syncing RSS feed:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: (error as Error).message },
      { status: 500 },
    );
  }
}
