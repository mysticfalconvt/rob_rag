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

    // Get origin from request - check multiple headers for production environments
    const forwardedHost = req.headers.get("x-forwarded-host");
    const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("host");

    let origin: string;
    if (forwardedHost) {
      origin = `${forwardedProto}://${forwardedHost}`;
    } else if (host) {
      origin = `${forwardedProto}://${host}`;
    } else {
      origin = new URL(req.url).origin;
    }

    console.log("[GoogleAuth] Initiating OAuth with origin:", origin);
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
