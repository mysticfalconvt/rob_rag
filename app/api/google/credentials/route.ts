import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";

/**
 * POST: Save Google Calendar credentials
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const { clientId, clientSecret } = await req.json();

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: "Client ID and Client Secret are required" },
        { status: 400 }
      );
    }

    // Save credentials to settings
    await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        googleClientId: clientId,
        googleClientSecret: clientSecret,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[GoogleCredentials] Error saving credentials:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save credentials",
      },
      { status: 500 }
    );
  }
}
