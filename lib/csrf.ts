import { NextRequest } from "next/server";
import { getSession } from "./session";

/**
 * CSRF Protection for state-changing operations
 *
 * This implements a double-submit cookie pattern where:
 * 1. Client reads CSRF token from session
 * 2. Client sends token in X-CSRF-Token header
 * 3. Server validates token matches session
 */

const CSRF_HEADER = "x-csrf-token";

/**
 * Generate a CSRF token for the current session
 */
export async function generateCsrfToken(): Promise<string> {
  const session = await getSession();

  // Generate new token if one doesn't exist
  if (!session.csrfToken) {
    const token = generateRandomToken();
    (session as any).csrfToken = token;
    await session.save();
    return token;
  }

  return session.csrfToken as string;
}

/**
 * Validate CSRF token from request
 * Throws error if token is missing or invalid
 */
export async function validateCsrfToken(req: NextRequest): Promise<void> {
  const session = await getSession();

  // Skip CSRF check if not logged in (will fail auth check anyway)
  if (!session.isLoggedIn) {
    return;
  }

  const headerToken = req.headers.get(CSRF_HEADER);
  const sessionToken = session.csrfToken as string | undefined;

  if (!headerToken) {
    throw new Error("CSRF token missing");
  }

  if (!sessionToken) {
    throw new Error("CSRF token not found in session");
  }

  if (headerToken !== sessionToken) {
    throw new Error("CSRF token mismatch");
  }
}

/**
 * Generate a cryptographically secure random token
 */
function generateRandomToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Middleware-style CSRF validation for API routes
 * Use this for all POST/PUT/PATCH/DELETE operations
 */
export async function requireCsrf(req: NextRequest): Promise<void> {
  // Only check CSRF on state-changing methods
  const method = req.method?.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return;
  }

  await validateCsrfToken(req);
}
