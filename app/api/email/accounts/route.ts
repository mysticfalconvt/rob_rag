import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";

/**
 * GET /api/email/accounts — List current user's email accounts
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const accounts = await prisma.emailAccount.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        provider: true,
        email: true,
        label: true,
        permissions: true,
        enabled: true,
        imapHost: true,
        imapPort: true,
        lastConnected: true,
        connectionError: true,
        gmailTokenExpiry: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Add computed fields
    const accountsWithStatus = accounts.map((a) => ({
      ...a,
      isAuthenticated:
        a.provider === "gmail"
          ? !!(a.gmailTokenExpiry && a.gmailTokenExpiry > new Date())
          : true, // Zoho uses password, always "authenticated" if configured
      hasCredentials:
        a.provider === "gmail"
          ? !!a.gmailTokenExpiry
          : true,
    }));

    return NextResponse.json(accountsWithStatus);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[EmailAccounts] Error listing accounts:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * POST /api/email/accounts — Create a new email account
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();

    const { provider, email, label, permissions, imapHost, imapPort, imapPassword } = body;

    if (!provider || !email) {
      return NextResponse.json(
        { error: "Provider and email are required" },
        { status: 400 }
      );
    }

    if (!["gmail", "zoho"].includes(provider)) {
      return NextResponse.json(
        { error: "Provider must be 'gmail' or 'zoho'" },
        { status: 400 }
      );
    }

    // Check for duplicate
    const existing = await prisma.emailAccount.findUnique({
      where: {
        userId_email: {
          userId: session.user.id,
          email,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    const account = await prisma.emailAccount.create({
      data: {
        userId: session.user.id,
        provider,
        email,
        label: label || null,
        permissions: permissions || "read",
        imapHost: provider === "zoho" ? (imapHost || "imap.zoho.com") : null,
        imapPort: provider === "zoho" ? (imapPort || 993) : null,
        imapPassword: provider === "zoho" ? (imapPassword || null) : null,
      },
    });

    return NextResponse.json({
      id: account.id,
      provider: account.provider,
      email: account.email,
      label: account.label,
      permissions: account.permissions,
      enabled: account.enabled,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[EmailAccounts] Error creating account:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
