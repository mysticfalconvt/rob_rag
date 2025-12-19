import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { getAuthUrl } from "@/lib/googleCalendar";

/**
 * Initiate Google OAuth flow
 */
export async function GET(req: NextRequest) {
  try {
    // Require authentication (admin only could be enforced here)
    await requireAuth(req);

    // Get origin from request to construct correct redirect URI
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const authUrl = await getAuthUrl(origin);

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("[GoogleAuth] Error initiating OAuth:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to initiate OAuth",
      },
      { status: 500 }
    );
  }
}
