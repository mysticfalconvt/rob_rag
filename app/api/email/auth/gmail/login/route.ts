import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { google } from "googleapis";
import prisma from "@/lib/prisma";

/**
 * GET /api/email/auth/gmail/login?accountId=xxx
 * Initiates Gmail OAuth flow for a specific email account
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");

    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }

    // Verify ownership
    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
      select: { userId: true, provider: true },
    });

    if (!account || account.userId !== session.user.id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    if (account.provider !== "gmail") {
      return NextResponse.json({ error: "Account is not a Gmail account" }, { status: 400 });
    }

    // Get Google credentials from Settings
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { googleClientId: true, googleClientSecret: true },
    });

    if (!settings?.googleClientId || !settings?.googleClientSecret) {
      return NextResponse.json(
        { error: "Google Client ID/Secret not configured. Set them up in Calendar integration first." },
        { status: 400 }
      );
    }

    // Determine redirect URI
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

    const redirectUri = process.env.GMAIL_REDIRECT_URI || `${origin}/api/email/auth/gmail/callback`;

    const oauth2Client = new google.auth.OAuth2(
      settings.googleClientId,
      settings.googleClientSecret,
      redirectUri
    );

    // Gmail scopes: readonly for read, modify for write/delete
    const scopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
      state: accountId, // Pass accountId through OAuth state
    });

    console.log(`[GmailOAuth] Initiating OAuth for account ${accountId}, redirect: ${redirectUri}`);

    return NextResponse.json({ authUrl });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GmailOAuth] Error initiating OAuth:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initiate OAuth" },
      { status: 500 }
    );
  }
}
