/**
 * Simple in-memory rate limiter for login attempts
 * Tracks failed login attempts per IP address and email
 */

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  blockedUntil?: number;
}

// Store rate limit data in memory
// In production, consider using Redis for distributed rate limiting
const ipAttempts = new Map<string, RateLimitEntry>();
const emailAttempts = new Map<string, RateLimitEntry>();

// Configuration
const MAX_ATTEMPTS = 5; // Max failed attempts before blocking
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes window
const BLOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes block duration

/**
 * Clean up old entries to prevent memory leaks
 */
function cleanup() {
  const now = Date.now();

  // Clean IP attempts
  for (const [key, entry] of ipAttempts.entries()) {
    if (entry.blockedUntil && now > entry.blockedUntil) {
      ipAttempts.delete(key);
    } else if (now - entry.firstAttempt > WINDOW_MS) {
      ipAttempts.delete(key);
    }
  }

  // Clean email attempts
  for (const [key, entry] of emailAttempts.entries()) {
    if (entry.blockedUntil && now > entry.blockedUntil) {
      emailAttempts.delete(key);
    } else if (now - entry.firstAttempt > WINDOW_MS) {
      emailAttempts.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanup, 5 * 60 * 1000);

/**
 * Check if an IP or email is rate limited
 */
export function checkRateLimit(
  identifier: string,
  type: "ip" | "email",
): {
  allowed: boolean;
  remainingAttempts: number;
  resetTime: number;
  blockedUntil?: number;
} {
  const now = Date.now();
  const store = type === "ip" ? ipAttempts : emailAttempts;
  const entry = store.get(identifier);

  // No previous attempts
  if (!entry) {
    return {
      allowed: true,
      remainingAttempts: MAX_ATTEMPTS,
      resetTime: now + WINDOW_MS,
    };
  }

  // Currently blocked
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return {
      allowed: false,
      remainingAttempts: 0,
      resetTime: entry.blockedUntil,
      blockedUntil: entry.blockedUntil,
    };
  }

  // Window expired, reset
  if (now - entry.firstAttempt > WINDOW_MS) {
    store.delete(identifier);
    return {
      allowed: true,
      remainingAttempts: MAX_ATTEMPTS,
      resetTime: now + WINDOW_MS,
    };
  }

  // Check if max attempts reached
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_DURATION_MS;
    return {
      allowed: false,
      remainingAttempts: 0,
      resetTime: entry.blockedUntil,
      blockedUntil: entry.blockedUntil,
    };
  }

  // Still within limits
  return {
    allowed: true,
    remainingAttempts: MAX_ATTEMPTS - entry.count,
    resetTime: entry.firstAttempt + WINDOW_MS,
  };
}

/**
 * Record a failed login attempt
 */
export function recordFailedAttempt(
  identifier: string,
  type: "ip" | "email",
): void {
  const now = Date.now();
  const store = type === "ip" ? ipAttempts : emailAttempts;
  const entry = store.get(identifier);

  if (!entry) {
    store.set(identifier, {
      count: 1,
      firstAttempt: now,
    });
  } else if (now - entry.firstAttempt > WINDOW_MS) {
    // Reset if window expired
    store.set(identifier, {
      count: 1,
      firstAttempt: now,
    });
  } else {
    entry.count++;

    // Block if max attempts reached
    if (entry.count >= MAX_ATTEMPTS) {
      entry.blockedUntil = now + BLOCK_DURATION_MS;
    }
  }
}

/**
 * Record a successful login (clears attempts)
 */
export function recordSuccessfulLogin(
  identifier: string,
  type: "ip" | "email",
): void {
  const store = type === "ip" ? ipAttempts : emailAttempts;
  store.delete(identifier);
}

/**
 * Get all rate limit entries (for admin monitoring)
 */
export function getAllRateLimitEntries(): {
  ip: Array<{ identifier: string; entry: RateLimitEntry }>;
  email: Array<{ identifier: string; entry: RateLimitEntry }>;
} {
  return {
    ip: Array.from(ipAttempts.entries()).map(([identifier, entry]) => ({
      identifier,
      entry,
    })),
    email: Array.from(emailAttempts.entries()).map(([identifier, entry]) => ({
      identifier,
      entry,
    })),
  };
}

/**
 * Clear rate limit for a specific identifier (admin function)
 */
export function clearRateLimit(
  identifier: string,
  type: "ip" | "email",
): boolean {
  const store = type === "ip" ? ipAttempts : emailAttempts;
  return store.delete(identifier);
}

/**
 * Helper to get client IP from request
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  if (realIp) {
    return realIp;
  }

  // Fallback (won't work in production with reverse proxy)
  return "unknown";
}
