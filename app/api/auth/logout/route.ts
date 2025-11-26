import { NextRequest, NextResponse } from "next/server";
import { destroySession, requireAuth } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    // Check if user is logged in
    await requireAuth(req);

    // Destroy session
    await destroySession();

    return NextResponse.json({ success: true });
  } catch (error) {
    // Even if not authenticated, return success (idempotent operation)
    return NextResponse.json({ success: true });
  }
}
