import { NextRequest, NextResponse } from "next/server";
import { scanAllFiles } from "@/lib/indexer";
import { requireAuth } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const result = await scanAllFiles();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error scanning files:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
