import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import prisma from "@/lib/prisma";

/**
 * GET /api/email/auth/gmail/callback
 * Handles Gmail OAuth callback, stores tokens in EmailAccount
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const accountId = searchParams.get("state"); // accountId passed through state

    // Determine origin for redirect
    const forwardedHost = req.headers.get("x-forwarded-host");
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const host = req.headers.get("host");
    const urlOrigin = new URL(req.url).origin;

    let origin: string;
    if (forwardedHost && forwardedProto) {
      origin = `${forwardedProto}://${forwardedHost}`;
    } else if (forwardedHost) {
      origin = `https://${forwardedHost}`;
    } else if (host) {
      const proto = host.includes("localhost") || /:\d+$/.test(host) ? "http" : "https";
      origin = `${proto}://${host}`;
    } else {
      origin = urlOrigin;
    }

    if (error) {
      return NextResponse.redirect(
        `${origin}/config?email_auth=error&message=${encodeURIComponent(error)}`
      );
    }

    if (!code || !accountId) {
      return NextResponse.redirect(
        `${origin}/config?email_auth=error&message=${encodeURIComponent("Missing authorization code or account ID")}`
      );
    }

    // Get Google credentials
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { googleClientId: true, googleClientSecret: true },
    });

    if (!settings?.googleClientId || !settings?.googleClientSecret) {
      return NextResponse.redirect(
        `${origin}/config?email_auth=error&message=${encodeURIComponent("Google credentials not configured")}`
      );
    }

    const redirectUri = process.env.GMAIL_REDIRECT_URI || `${origin}/api/email/auth/gmail/callback`;

    const oauth2Client = new google.auth.OAuth2(
      settings.googleClientId,
      settings.googleClientSecret,
      redirectUri
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    console.log(`[GmailOAuth] Callback received for account ${accountId}`);

    // Verify account exists
    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      return NextResponse.redirect(
        `${origin}/config?email_auth=error&message=${encodeURIComponent("Email account not found")}`
      );
    }

    // Store tokens in the EmailAccount record
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: {
        gmailAccessToken: tokens.access_token || null,
        gmailRefreshToken: tokens.refresh_token || null,
        gmailTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        lastConnected: new Date(),
        connectionError: null,
      },
    });

    console.log(`[GmailOAuth] Tokens saved for account ${accountId} (${account.email})`);

    return NextResponse.redirect(`${origin}/config?email_auth=success`);
  } catch (error) {
    console.error("[GmailOAuth] Error handling callback:", error);
    const errorMessage = error instanceof Error ? error.message : "Authentication failed";

    // Try to redirect gracefully
    try {
      const origin = new URL(req.url).origin;
      return NextResponse.redirect(
        `${origin}/config?email_auth=error&message=${encodeURIComponent(errorMessage)}`
      );
    } catch {
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  }
}
