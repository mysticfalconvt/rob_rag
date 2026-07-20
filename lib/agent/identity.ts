import prisma from "../prisma";
import type { AgentUserProfile } from "./types";

const USER_SELECT = {
  id: true,
  userName: true,
  userBio: true,
  userPreferences: true,
} as const;

function toProfile(user: {
  userName: string | null;
  userBio: string | null;
  userPreferences: string | null;
}): AgentUserProfile {
  return {
    userName: user.userName || null,
    userBio: user.userBio || null,
    userPreferences: user.userPreferences
      ? JSON.parse(user.userPreferences)
      : null,
  };
}

/**
 * Resolve a Matrix sender (MXID) to a real, stable AuthUser identity.
 *
 * Resolution order:
 *  1. An AuthUser explicitly linked to this MXID (`matrixUserId`) — the way the
 *     owner links their own account for full personalization.
 *  2. If the sender is in `matrixAllowedUsers`, fall back to the admin account
 *     (preserves the previous "allowed users use the owner's profile" behaviour).
 *  3. Otherwise auto-provision a per-sender AuthUser (role "matrix", inactive) so
 *     the sender gets a stable identity and conversations can be persisted with a
 *     valid foreign key instead of collapsing to a shared "system" user.
 */
export async function resolveMatrixIdentity(
  sender: string,
  displayName: string,
): Promise<{ userId: string; userProfile: AgentUserProfile }> {
  // 1. Explicit link
  const linked = await prisma.authUser.findUnique({
    where: { matrixUserId: sender },
    select: USER_SELECT,
  });
  if (linked) {
    return { userId: linked.id, userProfile: toProfile(linked) };
  }

  // 2. Allowed users -> owner/admin profile
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
    select: { matrixAllowedUsers: true },
  });
  let isAllowed = false;
  if (settings?.matrixAllowedUsers) {
    try {
      const allowed = JSON.parse(settings.matrixAllowedUsers);
      isAllowed = Array.isArray(allowed) && allowed.includes(sender);
    } catch {
      isAllowed = false;
    }
  }
  if (isAllowed) {
    const admin = await prisma.authUser.findFirst({
      where: { role: "admin" },
      select: USER_SELECT,
    });
    if (admin) {
      return { userId: admin.id, userProfile: toProfile(admin) };
    }
  }

  // 3. Auto-provision a per-sender identity
  try {
    const created = await prisma.authUser.create({
      data: {
        email: `matrix:${sender}`,
        name: displayName || sender,
        passwordHash: "!matrix-no-login",
        role: "matrix",
        isActive: false,
        userName: displayName || sender,
        userBio: `Matrix ID: ${sender}`,
        matrixUserId: sender,
      },
      select: USER_SELECT,
    });
    return { userId: created.id, userProfile: toProfile(created) };
  } catch {
    // Lost a provisioning race (unique constraint) — re-read.
    const existing = await prisma.authUser.findUnique({
      where: { matrixUserId: sender },
      select: USER_SELECT,
    });
    if (existing) {
      return { userId: existing.id, userProfile: toProfile(existing) };
    }
    throw new Error(`Failed to resolve Matrix identity for ${sender}`);
  }
}

/**
 * Resolve the tool/data-source capabilities a Matrix sender is allowed to use.
 *
 * Returns:
 *  - `null`      -> allow everything (no policy row, or the sender is the admin).
 *                   This is the non-breaking default.
 *  - `string[]`  -> the exhaustive list of permitted capability-group keys.
 *
 * Admins are never restricted (prevents the owner locking themselves out).
 */
export async function resolveMatrixCapabilities(
  sender: string,
): Promise<string[] | null> {
  // Admin bypass: a sender linked to an admin AuthUser always gets full access.
  const linked = await prisma.authUser.findUnique({
    where: { matrixUserId: sender },
    select: { role: true },
  });
  if (linked?.role === "admin") return null;

  const policy = await prisma.matrixUserPolicy.findUnique({
    where: { matrixUserId: sender },
    select: { allowedCapabilities: true },
  });
  if (!policy) return null; // no policy -> allow all

  try {
    const parsed = JSON.parse(policy.allowedCapabilities);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null; // corrupt policy -> fail open (allow all), never lock out
  }
}

/** Resolve the admin identity used for scheduled task execution. */
export async function resolveScheduledIdentity(): Promise<{
  userId: string;
  userProfile: AgentUserProfile;
}> {
  const admin = await prisma.authUser.findFirst({
    where: { role: "admin" },
    select: USER_SELECT,
  });
  if (admin) {
    return { userId: admin.id, userProfile: toProfile(admin) };
  }
  throw new Error("No admin user found for scheduled task execution");
}
