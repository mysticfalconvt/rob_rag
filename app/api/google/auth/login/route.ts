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
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const host = req.headers.get("host");
    const urlOrigin = new URL(req.url).origin;

    let origin: string;
    if (forwardedHost && forwardedProto) {
      origin = `${forwardedProto}://${forwardedHost}`;
    } else if (forwardedHost) {
      // If forwarded host exists but no proto, assume https (common in reverse proxies)
      origin = `https://${forwardedHost}`;
    } else if (host) {
      // Detect protocol from host: localhost or has port = http, otherwise https
      const proto = host.includes("localhost") || /:\d+$/.test(host) ? "http" : "https";
      origin = `${proto}://${host}`;
    } else {
      origin = urlOrigin;
    }

    console.log("[GoogleAuth] Initiating OAuth with origin:", origin, "headers:", {
      forwardedHost,
      forwardedProto,
      host,
      urlOrigin
    });
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
