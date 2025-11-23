import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: {
        userName: true,
        userBio: true,
        userPreferences: true,
      },
    });

    return NextResponse.json({
      userName: settings?.userName || null,
      userBio: settings?.userBio || null,
      userPreferences: settings?.userPreferences
        ? JSON.parse(settings.userPreferences)
        : null,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch user profile" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userName, userBio, userPreferences } = body;

    // Get or create settings
    let settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings) {
      // Create default settings if they don't exist
      settings = await prisma.settings.create({
        data: {
          id: "singleton",
          embeddingModel: "nomic-ai/nomic-embed-text-v1.5-GGUF",
          chatModel: "meta-llama-3.1-8b-instruct",
          embeddingModelDimension: 768,
        },
      });
    }

    // Update profile
    const updatedSettings = await prisma.settings.update({
      where: { id: "singleton" },
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
      userName: updatedSettings.userName || null,
      userBio: updatedSettings.userBio || null,
      userPreferences: updatedSettings.userPreferences
        ? JSON.parse(updatedSettings.userPreferences)
        : null,
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    return NextResponse.json(
      { error: "Failed to update user profile" },
      { status: 500 },
    );
  }
}
