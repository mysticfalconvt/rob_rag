import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, ensureAdminUser } from "@/lib/auth";
import { createSession } from "@/lib/session";
import {
  checkRateLimit,
  recordFailedAttempt,
  recordSuccessfulLogin,
  getClientIp,
} from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    // Get client IP for rate limiting
    const clientIp = getClientIp(req);

    // Check rate limits (both IP and email)
    const ipLimit = checkRateLimit(clientIp, "ip");
    const emailLimit = checkRateLimit(email.toLowerCase(), "email");

    if (!ipLimit.allowed) {
      const minutesLeft = Math.ceil(
        (ipLimit.blockedUntil! - Date.now()) / 60000,
      );
      return NextResponse.json(
        {
          error: `Too many login attempts from this IP. Please try again in ${minutesLeft} minutes.`,
        },
        { status: 429 },
      );
    }

    if (!emailLimit.allowed) {
      const minutesLeft = Math.ceil(
        (emailLimit.blockedUntil! - Date.now()) / 60000,
      );
      return NextResponse.json(
        {
          error: `Too many login attempts for this account. Please try again in ${minutesLeft} minutes.`,
        },
        { status: 429 },
      );
    }

    // Ensure admin user exists (creates if no users exist)
    await ensureAdminUser();

    // Authenticate user
    const user = await authenticateUser(email, password);

    if (!user) {
      // Record failed attempt for both IP and email
      recordFailedAttempt(clientIp, "ip");
      recordFailedAttempt(email.toLowerCase(), "email");

      const remaining = Math.min(
        ipLimit.remainingAttempts - 1,
        emailLimit.remainingAttempts - 1,
      );

      // Generic error message to avoid revealing whether email exists or account status
      return NextResponse.json(
        {
          error:
            remaining > 0
              ? `Invalid credentials. ${remaining} attempts remaining.`
              : "Invalid credentials. Account temporarily locked.",
        },
        { status: 401 },
      );
    }

    // Successful login - clear rate limit attempts
    recordSuccessfulLogin(clientIp, "ip");
    recordSuccessfulLogin(email.toLowerCase(), "email");

    // Create session (with request for tracking)
    await createSession(user, req);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
