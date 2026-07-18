import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

function tokenPreview(token: string): string {
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function handleError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error.message.includes("Forbidden")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  console.error("[Todo Accounts API] Error:", error);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

/** GET — list configured member accounts (never returns the raw token). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const accounts = await prisma.todoAccount.findMany({
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        label: a.label,
        enabled: a.enabled,
        tokenPreview: tokenPreview(a.apiToken),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

/** POST — add a member account { label, apiToken }. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { label, apiToken } = await req.json();
    if (!label?.trim() || !apiToken?.trim()) {
      return NextResponse.json(
        { error: "label and apiToken are required" },
        { status: 400 },
      );
    }
    const account = await prisma.todoAccount.create({
      data: { label: label.trim(), apiToken: apiToken.trim() },
    });
    return NextResponse.json({
      success: true,
      account: {
        id: account.id,
        label: account.label,
        enabled: account.enabled,
        tokenPreview: tokenPreview(account.apiToken),
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE — remove a member account by ?id=. */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await prisma.todoAccount.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
