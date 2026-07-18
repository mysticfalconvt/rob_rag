import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

const DEFAULT_BASE_URL = "https://todo.rboskind.com";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });
    const account = await prisma.todoAccount.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: "asc" },
    });

    if (!account) {
      return NextResponse.json(
        { error: "Add at least one Todo XP member token first" },
        { status: 400 },
      );
    }

    const baseUrl = (settings?.todoBaseUrl || DEFAULT_BASE_URL).replace(
      /\/$/,
      "",
    );
    const res = await fetch(`${baseUrl}/api/v1/today`, {
      headers: {
        Authorization: `Bearer ${account.apiToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error:
            res.status === 401
              ? `Todo XP rejected ${account.label}'s token (401). Re-mint it in Todo XP settings.`
              : `Todo XP API returned ${res.status}: ${body.slice(0, 200) || res.statusText}`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, testedMember: account.label });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Error testing Todo XP connection:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connection failed" },
      { status: 500 },
    );
  }
}
