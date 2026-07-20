import { type NextRequest, NextResponse } from "next/server";
import { ALL_CAPABILITY_KEYS } from "@/lib/agent/capabilities";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

/**
 * POST /api/matrix/permissions
 *
 * Upsert (or reset) a Matrix user's tool/data-source policy.
 *
 * Body:
 *   { matrixUserId: string, displayName?: string,
 *     allowedCapabilities: string[] | null }
 *
 * - allowedCapabilities === null  -> delete the policy row (reset to full/
 *   unrestricted access).
 * - allowedCapabilities === []    -> everything denied except always-on utilities.
 * - otherwise                     -> stored verbatim (unknown keys are dropped).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { matrixUserId, displayName, allowedCapabilities } = body ?? {};

    if (typeof matrixUserId !== "string" || !matrixUserId.trim()) {
      return NextResponse.json(
        { error: "matrixUserId is required" },
        { status: 400 },
      );
    }
    const mxid = matrixUserId.trim();

    // null => reset to unrestricted by removing the policy row.
    if (allowedCapabilities === null) {
      await prisma.matrixUserPolicy.deleteMany({
        where: { matrixUserId: mxid },
      });
      return NextResponse.json({ success: true, allowedCapabilities: null });
    }

    if (!Array.isArray(allowedCapabilities)) {
      return NextResponse.json(
        { error: "allowedCapabilities must be an array or null" },
        { status: 400 },
      );
    }

    // Keep only recognized capability keys (defensive against stale UIs).
    const valid = allowedCapabilities
      .map(String)
      .filter((k) => ALL_CAPABILITY_KEYS.includes(k));
    const serialized = JSON.stringify(valid);

    await prisma.matrixUserPolicy.upsert({
      where: { matrixUserId: mxid },
      create: {
        matrixUserId: mxid,
        displayName: typeof displayName === "string" ? displayName : null,
        allowedCapabilities: serialized,
      },
      update: {
        ...(typeof displayName === "string" ? { displayName } : {}),
        allowedCapabilities: serialized,
      },
    });

    return NextResponse.json({ success: true, allowedCapabilities: valid });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[Matrix Permissions API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
