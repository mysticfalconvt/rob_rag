import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import prisma from "@/lib/prisma";
import { matrixClient } from "@/lib/matrix/client";
import { initializeMessageHandler } from "@/lib/matrix/messageHandler";

/**
 * GET /api/matrix/config
 * Get Matrix configuration (with masked token)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    // Require admin role
    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: {
        matrixHomeserver: true,
        matrixAccessToken: true,
        matrixUserId: true,
        matrixEnabled: true,
        matrixAllowedUsers: true,
      },
    });

    // Mask the access token
    const maskedToken = settings?.matrixAccessToken
      ? settings.matrixAccessToken.substring(0, 10) + "..." + settings.matrixAccessToken.substring(settings.matrixAccessToken.length - 4)
      : null;

    // Parse allowed users
    let allowedUsers: string[] = [];
    if (settings?.matrixAllowedUsers) {
      try {
        allowedUsers = JSON.parse(settings.matrixAllowedUsers);
      } catch (e) {
        console.error("Failed to parse matrixAllowedUsers:", e);
      }
    }

    return NextResponse.json({
      homeserver: settings?.matrixHomeserver || null,
      accessToken: maskedToken,
      userId: settings?.matrixUserId || null,
      enabled: settings?.matrixEnabled || false,
      allowedUsers,
      isRunning: matrixClient.isRunning(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Matrix Config API] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/matrix/config
 * Update Matrix configuration
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    // Require admin role
    const user = await prisma.authUser.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { homeserver, accessToken, userId, enabled, allowedUsers } = body;

    // Get current settings to check if we have existing credentials
    const currentSettings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: {
        matrixHomeserver: true,
        matrixAccessToken: true,
      },
    });

    // Validate required fields if enabling
    if (enabled) {
      const hasHomeserver = homeserver || currentSettings?.matrixHomeserver;
      const hasToken = accessToken || currentSettings?.matrixAccessToken;

      if (!hasHomeserver || !hasToken) {
        return NextResponse.json(
          { error: "Homeserver and access token are required when enabling Matrix" },
          { status: 400 },
        );
      }
    }

    // Test connection if providing new credentials
    if (homeserver || accessToken) {
      try {
        // Use provided credentials or fall back to current ones for testing
        const testHomeserver = homeserver || currentSettings?.matrixHomeserver || "";
        const testToken = accessToken || currentSettings?.matrixAccessToken || "";

        const testClient = await testMatrixConnection(testHomeserver, testToken);

        // Get user ID from the client if not provided
        const detectedUserId = userId || testClient.getUserId() || undefined;

        // Build update data - only update fields that are provided
        const updateData: any = {};
        if (homeserver) updateData.matrixHomeserver = homeserver;
        if (accessToken) updateData.matrixAccessToken = accessToken;
        if (detectedUserId) updateData.matrixUserId = detectedUserId;
        if (enabled !== undefined) updateData.matrixEnabled = enabled;
        if (allowedUsers !== undefined) {
          updateData.matrixAllowedUsers = JSON.stringify(allowedUsers);
        }

        // Update settings
        await prisma.settings.update({
          where: { id: "singleton" },
          data: updateData,
        });

        // Restart Matrix client if enabled
        if (enabled) {
          await matrixClient.stop();
          await matrixClient.initialize();

          // Initialize message handler when client is ready
          matrixClient.onReady(() => {
            console.log("[Matrix Config] Client ready, initializing message handler...");
            initializeMessageHandler();
          });
        } else {
          await matrixClient.stop();
        }

        return NextResponse.json({
          success: true,
          message: "Matrix configuration updated and client restarted",
          userId: detectedUserId,
        });
      } catch (error) {
        console.error("[Matrix Config API] Connection test failed:", error);
        return NextResponse.json(
          {
            error: "Failed to connect to Matrix server",
            details: error instanceof Error ? error.message : "Unknown error",
          },
          { status: 400 },
        );
      }
    } else {
      // Just update enabled status (no new credentials provided)
      await prisma.settings.update({
        where: { id: "singleton" },
        data: {
          matrixEnabled: enabled,
        },
      });

      if (enabled) {
        // Start client with existing credentials
        await matrixClient.stop();
        await matrixClient.initialize();

        // Initialize message handler when client is ready
        matrixClient.onReady(() => {
          console.log("[Matrix Config] Client ready, initializing message handler...");
          initializeMessageHandler();
        });
      } else {
        // Stop client if disabling
        await matrixClient.stop();
      }

      return NextResponse.json({
        success: true,
        message: `Matrix ${enabled ? "enabled" : "disabled"}`,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Matrix Config API] Error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * Test Matrix connection
 */
async function testMatrixConnection(
  homeserver: string,
  accessToken: string,
): Promise<any> {
  const { createClient } = await import("matrix-js-sdk");

  const testClient = createClient({
    baseUrl: homeserver,
    accessToken,
  });

  // Try to get account data to verify connection
  // @ts-ignore - Matrix SDK typing issue
  await testClient.getAccountData("m.push_rules");

  return testClient;
}
