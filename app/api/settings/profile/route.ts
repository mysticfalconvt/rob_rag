import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
      select: {
        userName: true,
        userBio: true,
        userPreferences: true,
      },
    });

    return NextResponse.json({
      userName: user?.userName || null,
      userBio: user?.userBio || null,
      userPreferences: user?.userPreferences
        ? JSON.parse(user.userPreferences)
        : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching user profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch user profile" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();
    const { userName, userBio, userPreferences } = body;

    // Update user profile
    const updatedUser = await prisma.authUser.update({
      where: { id: session.user.id },
      data: {
        userName: userName !== undefined ? userName : undefined,
        userBio: userBio !== undefined ? userBio : undefined,
        userPreferences:
          userPreferences !== undefined
            ? JSON.stringify(userPreferences)
            : undefined,
      },
    });

    return NextResponse.json({
      userName: updatedUser.userName || null,
      userBio: updatedUser.userBio || null,
      userPreferences: updatedUser.userPreferences
        ? JSON.parse(updatedUser.userPreferences)
        : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error updating user profile:", error);
    return NextResponse.json(
      { error: "Failed to update user profile" },
      { status: 500 },
    );
  }
}
