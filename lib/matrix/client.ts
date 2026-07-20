// Suppress matrix-js-sdk multiple entrypoint warning
// This can happen in Next.js dev mode with hot reloading
if (typeof globalThis !== "undefined") {
  (globalThis as any).__js_sdk_entrypoint = false;
}

import {
  ClientEvent,
  createClient,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
  RoomMemberEvent,
  type SyncState,
} from "matrix-js-sdk";
import prisma from "../prisma";

/**
 * Matrix client singleton
 * Manages connection to Matrix homeserver and handles events
 */
class MatrixClientManager {
  private client: MatrixClient | null = null;
  private isStarted = false;
  private isStarting = false; // Track if initialization is in progress
  private isPrepared = false; // Track if client is synced and ready
  private reconnectAttempts = 0;
  private reconnectDelay = 5000; // Start with 5 seconds
  private maxReconnectDelay = 5 * 60 * 1000; // Cap backoff at 5 minutes
  private reconnectTimer: NodeJS.Timeout | null = null;
  // Persistent across reconnects: these fire on EVERY sync PREPARED (i.e. on the
  // initial connect AND after every reconnect), so consumers like the message
  // handler get re-attached to each new client instance.
  private readyListeners: Array<() => void> = [];

  /**
   * Initialize the Matrix client with settings from database
   */
  async initialize(): Promise<void> {
    // Prevent concurrent initialization
    if (this.isStarting) {
      console.log("[Matrix] Initialization already in progress, skipping");
      return;
    }

    if (this.client && this.isStarted) {
      console.log("[Matrix] Client already initialized and running");
      return;
    }

    this.isStarting = true;

    try {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
        select: {
          matrixHomeserver: true,
          matrixAccessToken: true,
          matrixUserId: true,
          matrixEnabled: true,
        },
      });

      if (!settings?.matrixEnabled) {
        console.log("[Matrix] Matrix integration is disabled");
        this.isStarting = false;
        return;
      }

      if (!settings.matrixHomeserver || !settings.matrixAccessToken) {
        console.log(
          "[Matrix] Matrix not configured (missing homeserver or token)",
        );
        this.isStarting = false;
        return;
      }

      console.log(
        `[Matrix] Initializing client (${settings.matrixHomeserver}, user: ${settings.matrixUserId || "not set"})`,
      );

      // Create client with suppressed HTTP request logging
      const silentLogger = {
        debug() {},
        info() {},
        warn() {},
        error() {},
        trace() {},
        getChild() {
          return silentLogger;
        },
      };
      this.client = createClient({
        baseUrl: settings.matrixHomeserver,
        accessToken: settings.matrixAccessToken,
        userId: settings.matrixUserId || undefined,
        logger: silentLogger as any,
      });

      // Set up event handlers before starting
      this.setupEventHandlers();

      // Start the client
      await this.start();

      console.log("[Matrix] Client initialized, waiting for sync...");
      this.isStarting = false;
    } catch (error) {
      console.error("[Matrix] Failed to initialize Matrix client:", error);
      this.isStarting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Start the Matrix client sync
   */
  private async start(): Promise<void> {
    if (!this.client || this.isStarted) {
      return;
    }

    try {
      await this.client.startClient({ initialSyncLimit: 10 });
      this.isStarted = true;
      this.reconnectAttempts = 0; // Reset on successful start
      // Client started
    } catch (error) {
      console.error("[Matrix] Failed to start Matrix client:", error);
      throw error;
    }
  }

  /**
   * Set up event handlers for the Matrix client
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    // Handle sync state changes
    this.client.on(ClientEvent.Sync as any, async (state: SyncState) => {
      // Only log significant state changes, not routine SYNCING
      if (state !== "SYNCING") {
        console.log(`[Matrix] Sync state: ${state}`);
      }

      if (state === "PREPARED") {
        this.isPrepared = true;
        this.reconnectAttempts = 0; // Reset on successful sync

        // Sync existing rooms to database
        try {
          await this.syncRoomsToDatabase();
        } catch (error) {
          console.error("[Matrix] Failed to sync rooms:", error);
        }

        // Invoke ALL ready listeners on every PREPARED (initial connect and
        // after each reconnect) so consumers re-attach to the new client.
        for (const cb of this.readyListeners) {
          try {
            cb();
          } catch (error) {
            console.error("[Matrix] ready listener threw:", error);
          }
        }
      } else if (state === "ERROR") {
        console.error("[Matrix] Sync error occurred");
        this.isPrepared = false;
        this.scheduleReconnect();
      }
    });

    // Handle room invites
    this.client.on(
      RoomMemberEvent.Membership as any,
      async (event: MatrixEvent, member: RoomMember) => {
        if (
          member.membership === "invite" &&
          member.userId === this.client?.getUserId()
        ) {
          console.log(`[Matrix] Received invite to room: ${member.roomId}`);
          try {
            await this.client?.joinRoom(member.roomId);
            console.log(`[Matrix] Joined room: ${member.roomId}`);

            // Add room to database
            const room = this.client?.getRoom(member.roomId);
            if (room) {
              await prisma.matrixRoom.upsert({
                where: { roomId: member.roomId },
                create: {
                  roomId: member.roomId,
                  name: room.name || "Unnamed Room",
                  description: room.getCanonicalAlias() || undefined,
                  enabled: true,
                },
                update: {},
              });
            }
          } catch (error: any) {
            // Handle specific Matrix errors
            if (error?.errcode === "M_UNKNOWN" && error?.httpStatus === 404) {
              console.warn(
                `[Matrix] Room ${member.roomId} is unreachable (404) - attempting to leave/forget`,
              );

              // Try to leave/forget the room to stop getting invites
              try {
                await this.client?.leave(member.roomId);
                console.log(`[Matrix] Left unreachable room ${member.roomId}`);
              } catch (leaveError: any) {
                console.error(
                  `[Matrix] Failed to leave unreachable room:`,
                  leaveError,
                );
                // If leave fails, try to forget it
                try {
                  await this.client?.forget(member.roomId);
                  console.log(
                    `[Matrix] Forgot unreachable room ${member.roomId}`,
                  );
                } catch (forgetError) {
                  console.error(
                    `[Matrix] Failed to forget unreachable room:`,
                    forgetError,
                  );
                }
              }

              // Clean up database entry for unreachable room
              try {
                await prisma.matrixRoom.deleteMany({
                  where: { roomId: member.roomId },
                });
              } catch (dbError) {
                console.error(
                  `[Matrix] Failed to clean up unreachable room from database:`,
                  dbError,
                );
              }
            } else {
              console.error(
                `[Matrix] Failed to join room ${member.roomId}:`,
                error,
              );
            }
          }
        }
      },
    );

    // Note: Message handling is done in messageHandler.ts to keep separation of concerns
  }

  /**
   * Schedule a reconnect attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    this.reconnectAttempts++;
    // Exponential backoff, capped — never permanently give up. A long-running
    // bot must keep trying to recover from homeserver outages / token blips.
    const delay = Math.min(
      this.reconnectDelay * 2 ** Math.min(this.reconnectAttempts - 1, 10),
      this.maxReconnectDelay,
    );

    console.log(
      `[Matrix] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay / 1000}s`,
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log(
        `[Matrix] Attempting reconnect #${this.reconnectAttempts}...`,
      );

      try {
        await this.stop();
        await this.initialize();
      } catch (error) {
        console.error("[Matrix] Reconnect failed:", error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Stop the Matrix client
   */
  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client && this.isStarted) {
      console.log("[Matrix] Stopping Matrix client...");
      this.client.stopClient();
      this.isStarted = false;
      this.isStarting = false;
      this.isPrepared = false;
      console.log("[Matrix] Matrix client stopped");
    }

    this.client = null;
    // NOTE: readyListeners are intentionally kept across stop()/reconnect so the
    // message handler is re-attached when the new client reaches PREPARED.
  }

  /**
   * Get the Matrix client instance
   */
  getClient(): MatrixClient | null {
    return this.client;
  }

  /**
   * Check if client is running
   */
  isRunning(): boolean {
    return this.isStarted && this.client !== null;
  }

  /**
   * Check if client is ready (synced and prepared)
   */
  isReady(): boolean {
    return this.isPrepared && this.isStarted && this.client !== null;
  }

  /**
   * Register a callback to run when the client is ready (sync PREPARED).
   * Registered once and kept for the lifetime of the process — it fires on the
   * initial connect and again after every reconnect (each new client instance),
   * so consumers (e.g. the message handler) re-attach to the current client.
   * If already prepared, also fires immediately.
   */
  onReady(callback: () => void): void {
    if (!this.readyListeners.includes(callback)) {
      this.readyListeners.push(callback);
    }
    if (this.isPrepared) {
      try {
        callback();
      } catch (error) {
        console.error("[Matrix] ready listener threw:", error);
      }
    }
  }

  /**
   * Send a message to a room
   */
  async sendMessage(roomId: string, content: string): Promise<void> {
    if (!this.client || !this.isStarted) {
      throw new Error("Matrix client is not running");
    }

    try {
      await this.client.sendTextMessage(roomId, content);
      console.log(`[Matrix] Sent message to room ${roomId}`);
    } catch (error) {
      console.error(
        `[Matrix] Failed to send message to room ${roomId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Send a typing indicator
   */
  async sendTyping(roomId: string, isTyping: boolean): Promise<void> {
    if (!this.client || !this.isStarted) {
      return;
    }

    try {
      await this.client.sendTyping(roomId, isTyping, isTyping ? 5000 : 0);
    } catch (error) {
      console.error(`[Matrix] Failed to send typing indicator:`, error);
    }
  }

  /**
   * Get all rooms the bot is in
   */
  getRooms(): Room[] {
    if (!this.client) {
      return [];
    }
    return this.client.getRooms();
  }

  /**
   * Get a specific room by ID
   */
  getRoom(roomId: string): Room | null {
    if (!this.client) {
      return null;
    }
    return this.client.getRoom(roomId);
  }

  /**
   * Sync all joined rooms to database
   */
  async syncRoomsToDatabase(): Promise<void> {
    if (!this.client) {
      throw new Error("Matrix client not available");
    }

    const rooms = this.getRooms();

    // Get list of room IDs we're currently in
    const joinedRoomIds = new Set<string>();

    for (const room of rooms) {
      try {
        const roomId = room.roomId;
        const myMembership = room.getMyMembership();

        // Only sync rooms we're actually in
        if (myMembership !== "join") {
          continue;
        }

        joinedRoomIds.add(roomId);

        await prisma.matrixRoom.upsert({
          where: { roomId },
          create: {
            roomId,
            name: room.name || "Unnamed Room",
            description: room.getCanonicalAlias() || undefined,
            enabled: true,
          },
          update: {
            name: room.name || undefined,
          },
        });

        // Room synced successfully
      } catch (error) {
        console.error(`[Matrix] Failed to sync room ${room.roomId}:`, error);
      }
    }

    // Clean up database entries for rooms we're no longer in
    try {
      const dbRooms = await prisma.matrixRoom.findMany({
        select: { roomId: true },
      });

      for (const dbRoom of dbRooms) {
        if (!joinedRoomIds.has(dbRoom.roomId)) {
          console.log(`[Matrix] Removing stale room: ${dbRoom.roomId}`);
          await prisma.matrixRoom.delete({
            where: { roomId: dbRoom.roomId },
          });
        }
      }
    } catch (error) {
      console.error(`[Matrix] Failed to clean up stale rooms:`, error);
    }

    console.log(`[Matrix] Synced ${joinedRoomIds.size} rooms`);
  }

  /**
   * Clean up unreachable or problematic room invites
   * This can help resolve issues with rooms that return 404 or other errors
   */
  async cleanupUnreachableInvites(): Promise<number> {
    if (!this.client) {
      throw new Error("Matrix client not available");
    }

    let cleanedCount = 0;
    const rooms = this.getRooms();

    for (const room of rooms) {
      try {
        const roomId = room.roomId;
        const myMembership = room.getMyMembership();

        // If we're in "invite" state, try to validate the room
        if (myMembership === "invite") {
          console.log(
            `[Matrix] Found invite for room ${roomId}, attempting to join or clean up...`,
          );

          try {
            await this.client.joinRoom(roomId);
            console.log(`[Matrix] Successfully joined room ${roomId}`);
          } catch (error: any) {
            if (error?.httpStatus === 404 || error?.errcode === "M_UNKNOWN") {
              console.warn(
                `[Matrix] Room ${roomId} is unreachable, leaving/forgetting...`,
              );

              try {
                await this.client.leave(roomId);
              } catch (leaveError) {
                // Ignore leave errors
              }

              try {
                await this.client.forget(roomId);
                cleanedCount++;
                console.log(
                  `[Matrix] Cleaned up unreachable invite for ${roomId}`,
                );
              } catch (forgetError) {
                console.error(
                  `[Matrix] Failed to forget room ${roomId}:`,
                  forgetError,
                );
              }

              // Remove from database
              await prisma.matrixRoom.deleteMany({
                where: { roomId },
              });
            }
          }
        }
      } catch (error) {
        console.error(`[Matrix] Error processing room ${room.roomId}:`, error);
      }
    }

    console.log(`[Matrix] Cleaned up ${cleanedCount} unreachable invites`);
    return cleanedCount;
  }
}

// Singleton instance.
//
// Parked on globalThis so ALL Next.js module instances (the instrumentation /
// scheduler context that connects at boot, and the API-route context that reads
// status) share the SAME client. Without this, API routes get a fresh,
// uninitialized MatrixClientManager and isRunning() reports false even though
// the bot is connected — which forced a "Save Configuration" to re-initialize
// the client inside the route's own instance.
const _matrixGlobal = globalThis as unknown as {
  __robrag_matrixClient?: MatrixClientManager;
};
export const matrixClient: MatrixClientManager =
  _matrixGlobal.__robrag_matrixClient ??
  (_matrixGlobal.__robrag_matrixClient = new MatrixClientManager());
