import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import prisma from "./prisma";

export interface SessionData {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
  };
  isLoggedIn: boolean;
  csrfToken?: string;
}

const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "rob_rag_session",
  cookieOptions: {
    secure: process.env.SESSION_SECURE === "true",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  },
};

/**
 * Get the current session
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * Get session from NextRequest (for API routes and middleware)
 */
export async function getSessionFromRequest(
  req: NextRequest,
): Promise<IronSession<SessionData>> {
  // Create a mock response to get cookies
  const res = new NextResponse();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  return session;
}

/**
 * Require authentication - throws if not logged in
 * Returns the session if authenticated
 */
export async function requireAuth(
  req: NextRequest,
): Promise<IronSession<SessionData>> {
  const session = await getSessionFromRequest(req);

  if (!session.isLoggedIn || !session.user) {
    throw new Error("Unauthorized");
  }

  // Verify user still exists and is active
  const user = await prisma.authUser.findUnique({
    where: { id: session.user.id },
    select: { id: true, isActive: true },
  });

  if (!user || !user.isActive) {
    // User doesn't exist or is inactive - destroy session
    session.destroy();
    throw new Error("Unauthorized");
  }

  return session;
}

/**
 * Require admin role - throws if not admin
 * Returns the session if authenticated and admin
 */
export async function requireAdmin(
  req: NextRequest,
): Promise<IronSession<SessionData>> {
  const session = await requireAuth(req);

  if (session.user.role !== "admin") {
    throw new Error("Forbidden: Admin access required");
  }

  return session;
}

/**
 * Create a session for a user
 */
export async function createSession(
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
  },
  req?: NextRequest,
): Promise<IronSession<SessionData>> {
  const session = await getSession();

  session.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
  };
  session.isLoggedIn = true;

  await session.save();

  // Log session creation for audit trail
  if (req) {
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";

    console.log(
      `[Auth] Session created for user ${user.id} (${user.email}) from IP ${ipAddress}`,
    );

    // Store session record for audit and admin monitoring
    const prisma = (await import("./prisma")).default;
    await prisma.session.create({
      data: {
        userId: user.id,
        token: `session_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        ipAddress,
        userAgent,
      },
    });

    // Clean up expired session records (keep database tidy)
    await prisma.session.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }

  return session;
}

/**
 * Destroy the current session
 */
export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

/**
 * Check if user is authenticated (non-throwing version)
 */
export async function isAuthenticated(req: NextRequest): Promise<boolean> {
  try {
    await requireAuth(req);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if user is admin (non-throwing version)
 */
export async function isAdmin(req: NextRequest): Promise<boolean> {
  try {
    await requireAdmin(req);
    return true;
  } catch {
    return false;
  }
}
