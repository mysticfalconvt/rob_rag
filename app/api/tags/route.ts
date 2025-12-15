import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

// GET all tags
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // "approved", "pending", or null for all

    const where = status ? { status } : {};

    const tags = await prisma.tag.findMany({
      where,
      include: {
        _count: {
          select: { documentTags: true },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });

    return NextResponse.json(
      tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        status: tag.status,
        color: tag.color,
        documentCount: tag._count.documentTags,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      })),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching tags:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST - Create new tag
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const { name, status = "pending", color } = await req.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Tag name is required" },
        { status: 400 },
      );
    }

    // Check if tag already exists
    const existing = await prisma.tag.findUnique({
      where: { name: name.toLowerCase().trim() },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Tag already exists", tag: existing },
        { status: 409 },
      );
    }

    const tag = await prisma.tag.create({
      data: {
        name: name.toLowerCase().trim(),
        status,
        color,
      },
    });

    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error creating tag:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
