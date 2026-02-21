import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { createEmailProvider } from "@/lib/email";
import { EmailAccountData } from "@/lib/email/types";

/**
 * POST /api/email/test — Test connection for an email account
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const { accountId } = await req.json();

    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });

    if (!account || account.userId !== session.user.id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    try {
      const provider = createEmailProvider(account as EmailAccountData);
      // Try listing a single unread email as a connection test
      const messages = await provider.listUnread(1);
      await provider.disconnect();

      // Update connection status
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: {
          lastConnected: new Date(),
          connectionError: null,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Connection successful. Found ${messages.length} unread email(s).`,
      });
    } catch (testError) {
      const errorMsg = testError instanceof Error ? testError.message : "Unknown error";

      // Update connection error
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: { connectionError: errorMsg },
      });

      return NextResponse.json({
        success: false,
        error: errorMsg,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[EmailTest] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
