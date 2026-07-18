import { type NextRequest, NextResponse } from "next/server";
import { readSoul, writeSoul, DEFAULT_SOUL } from "@/lib/assistant/store";
import { requireAdmin, requireAuth } from "@/lib/session";

function errorResponse(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error.message.includes("Forbidden")) {
      return NextResponse.json(
        { error: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }
  }
  console.error("[api/assistant/soul] error:", error);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    return NextResponse.json({ soul: await readSoul(), default: DEFAULT_SOUL });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { soul } = await req.json();
    if (typeof soul !== "string") {
      return NextResponse.json({ error: "Missing soul" }, { status: 400 });
    }
    await writeSoul(soul);
    return NextResponse.json({ soul: await readSoul() });
  } catch (error) {
    return errorResponse(error);
  }
}
