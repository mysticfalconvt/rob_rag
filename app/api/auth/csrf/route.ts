import { NextRequest, NextResponse } from "next/server";
import { generateCsrfToken } from "@/lib/csrf";
import { getSession } from "@/lib/session";

/**
 * GET /api/auth/csrf
 * Returns a CSRF token for the current session
 * Client should include this token in X-CSRF-Token header for state-changing requests
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();

    // Only provide CSRF token to authenticated users
    if (!session.isLoggedIn) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const token = await generateCsrfToken();

    return NextResponse.json({ csrfToken: token });
  } catch (error) {
    console.error("CSRF token generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate CSRF token" },
      { status: 500 },
    );
  }
}
