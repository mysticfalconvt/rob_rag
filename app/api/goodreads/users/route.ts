import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const users = await prisma.goodreadsUser.findMany({
      include: {
        goodreadsSources: true,
        _count: {
          select: { goodreadsBooks: true },
        },
      },
    });

    return NextResponse.json(users);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { name, email } = await req.json();

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const user = await prisma.goodreadsUser.create({
      data: { name, email },
    });

    return NextResponse.json(user);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error creating user:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
