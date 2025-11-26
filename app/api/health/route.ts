import { NextResponse } from "next/server";

export async function GET() {
  // Simple health check - no auth required
  // Just verify the server is responding
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
