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

    await handleAuthCallback(code);

    // Redirect back to status page with success message
    return NextResponse.redirect(
      new URL("/status?google_auth=success", req.url)
    );
  } catch (error) {
    console.error("[GoogleAuth] Error handling callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Authentication failed";
    return NextResponse.redirect(
      new URL(`/status?error=${encodeURIComponent(errorMessage)}`, req.url)
    );
  }
}
