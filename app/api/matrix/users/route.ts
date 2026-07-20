import { type NextRequest, NextResponse } from "next/server";
import { CAPABILITY_GROUPS } from "@/lib/agent/capabilities";
import { matrixClient } from "@/lib/matrix/client";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

/**
 * GET /api/matrix/users
 *
 * Discover every Matrix user that shares a joined room with the bot, deduped
 * across rooms, along with each user's current tool/data-source policy and the
 * capability catalog used to render the permission checkboxes.
 *
 * A user with no policy row is unrestricted (allowedCapabilities === null).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const catalog = CAPABILITY_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      description: g.description,
    }));

    const client = matrixClient.getClient();
    const botUserId = client?.getUserId() || null;

    // Aggregate joined members across all rooms the bot is joined to.
    const discovered = new Map<
      string,
      { userId: string; displayName: string; rooms: string[] }
    >();

    if (client) {
      for (const room of client.getRooms()) {
        if (room.getMyMembership() !== "join") continue;
        const roomLabel = room.name || room.roomId;
        for (const member of room.getJoinedMembers()) {
          if (!member.userId || member.userId === botUserId) continue;
          const existing = discovered.get(member.userId);
          if (existing) {
            if (!existing.rooms.includes(roomLabel)) {
              existing.rooms.push(roomLabel);
            }
          } else {
            discovered.set(member.userId, {
              userId: member.userId,
              displayName:
                member.name || member.rawDisplayName || member.userId,
              rooms: [roomLabel],
            });
          }
        }
      }
    }

    // Load existing policies. Include users that have a policy even if they are
    // not currently in a shared room (so you don't "lose" a saved policy).
    const policies = await prisma.matrixUserPolicy.findMany();
    const policyByUser = new Map(policies.map((p) => [p.matrixUserId, p]));

    for (const p of policies) {
      if (!discovered.has(p.matrixUserId)) {
        discovered.set(p.matrixUserId, {
          userId: p.matrixUserId,
          displayName: p.displayName || p.matrixUserId,
          rooms: [],
        });
      }
    }

    const users = Array.from(discovered.values())
      .map((u) => {
        const policy = policyByUser.get(u.userId);
        let allowedCapabilities: string[] | null = null;
        if (policy) {
          try {
            const parsed = JSON.parse(policy.allowedCapabilities);
            allowedCapabilities = Array.isArray(parsed)
              ? parsed.map(String)
              : [];
          } catch {
            allowedCapabilities = [];
          }
        }
        return { ...u, allowedCapabilities };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({
      users,
      capabilities: catalog,
      clientRunning: matrixClient.isRunning(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[Matrix Users API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
