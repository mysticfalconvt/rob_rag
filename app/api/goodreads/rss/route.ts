import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { parseGoodreadsRSS, importBooksForUser } from "@/lib/goodreads";

export async function POST(req: Request) {
  try {
    const { userId, rssFeedUrl } = await req.json();

    if (!userId || !rssFeedUrl) {
      return NextResponse.json(
        { error: "User ID and RSS feed URL are required" },
        { status: 400 },
      );
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Create or update RSS source
    const source = await prisma.goodreadsSource.upsert({
      where: {
        userId,
      },
      update: {
        rssFeedUrl,
      },
      create: {
        userId,
        rssFeedUrl,
      },
    });

    return NextResponse.json(source);
  } catch (error) {
    console.error("Error configuring RSS feed:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 },
      );
    }

    const source = await prisma.goodreadsSource.findFirst({
      where: { userId },
    });

    return NextResponse.json(source);
  } catch (error) {
    console.error("Error fetching RSS source:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
