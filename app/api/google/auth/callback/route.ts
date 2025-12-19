import { type NextRequest, NextResponse } from "next/server";
import { handleAuthCallback } from "@/lib/googleCalendar";

/**
 * Handle Google OAuth callback
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        new URL(`/status?error=${encodeURIComponent(error)}`, req.url)
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL("/status?error=No authorization code received", req.url)
      );
    }

    // Get origin from request - check multiple headers for production environments
    const forwardedHost = req.headers.get("x-forwarded-host");
    const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("host");
    const urlOrigin = new URL(req.url).origin;

    let origin: string;
    if (forwardedHost) {
      origin = `${forwardedProto}://${forwardedHost}`;
    } else if (host) {
      origin = `${forwardedProto}://${host}`;
    } else {
      origin = urlOrigin;
    }

    console.log("[GoogleAuth] Callback received - origin:", origin, "url:", req.url);
    await handleAuthCallback(code, origin);

    // Redirect back to status page with success message using the detected origin
    const redirectUrl = `${origin}/status?google_auth=success`;
    console.log("[GoogleAuth] Redirecting to:", redirectUrl);
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("[GoogleAuth] Error handling callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Authentication failed";
    return NextResponse.redirect(
      new URL(`/status?error=${encodeURIComponent(errorMessage)}`, req.url)
    );
  }
}
