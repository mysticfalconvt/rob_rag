import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { parseGoodreadsCSV, importBooksForUser } from "@/lib/goodreads";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const userId = formData.get("userId") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 },
      );
    }

    // Verify user exists
    const user = await prisma.goodreadsUser.findUnique({
      where: { id: userId },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Read CSV content
    const csvContent = await file.text();

    // Parse CSV
    const books = parseGoodreadsCSV(csvContent);

    // Import books
    const result = await importBooksForUser(userId, books);

    // Generate RAG chunks
    const { indexGoodreadsBooks } = await import("@/lib/goodreads");
    const indexedCount = await indexGoodreadsBooks(userId);

    return NextResponse.json({
      success: true,
      ...result,
      total: books.length,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error uploading Goodreads CSV:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: (error as Error).message },
      { status: 500 },
    );
  }
}
