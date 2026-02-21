import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";

/**
 * GET /api/email/accounts/[id] — Get single account
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;

    const account = await prisma.emailAccount.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
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
    });

    if (!account || account.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * PUT /api/email/accounts/[id] — Update account settings
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;
    const body = await req.json();

    // Verify ownership
    const existing = await prisma.emailAccount.findUnique({
      where: { id },
      select: { userId: true, provider: true },
    });

    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (body.label !== undefined) updateData.label = body.label;
    if (body.permissions !== undefined) updateData.permissions = body.permissions;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;

    // Zoho-specific fields
    if (existing.provider === "zoho") {
      if (body.imapHost !== undefined) updateData.imapHost = body.imapHost;
      if (body.imapPort !== undefined) updateData.imapPort = body.imapPort;
      if (body.imapPassword !== undefined) updateData.imapPassword = body.imapPassword;
    }

    const updated = await prisma.emailAccount.update({
      where: { id },
      data: updateData,
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
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * DELETE /api/email/accounts/[id] — Remove account
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(req);
    const { id } = await params;

    // Verify ownership
    const existing = await prisma.emailAccount.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.emailAccount.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
