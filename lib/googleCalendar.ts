import { google } from "googleapis";
import prisma from "./prisma";
import { generateEmbedding } from "./ai";
import { insertChunk } from "./pgvector";

// Sync lock to prevent concurrent sync operations
let syncInProgress = false;
let indexInProgress = false;

/**
 * Get redirect URI from environment or construct from request origin
 */
function getRedirectUri(origin?: string): string {
  // If GOOGLE_REDIRECT_URI is set, use it
  if (process.env.GOOGLE_REDIRECT_URI) {
    console.log("[GoogleCalendar] Using GOOGLE_REDIRECT_URI from env:", process.env.GOOGLE_REDIRECT_URI);
    return process.env.GOOGLE_REDIRECT_URI;
  }

  // Otherwise, construct from origin or default to localhost
  const baseUrl = origin || "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/google/auth/callback`;
  console.log("[GoogleCalendar] Constructed redirect URI:", redirectUri, "from origin:", origin);
  return redirectUri;
}

/**
 * Create OAuth2 client from settings
 */
export async function getOAuthClient(origin?: string) {
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
  });

  if (!settings?.googleClientId || !settings?.googleClientSecret) {
    throw new Error("Google Calendar not configured. Please add Client ID and Secret in settings.");
  }

  const redirectUri = getRedirectUri(origin);

  const oauth2Client = new google.auth.OAuth2(
    settings.googleClientId,
    settings.googleClientSecret,
    redirectUri
  );

  // Set credentials if we have tokens
  if (settings.googleAccessToken) {
    oauth2Client.setCredentials({
      access_token: settings.googleAccessToken,
      refresh_token: settings.googleRefreshToken || undefined,
      expiry_date: settings.googleTokenExpiresAt?.getTime(),
    });
  }

  return oauth2Client;
}

/**
 * Generate OAuth URL for initial authentication
 */
export async function getAuthUrl(origin?: string): Promise<string> {
  const oauth2Client = await getOAuthClient(origin);

  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
  ];

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent", // Force consent screen to get refresh token
  });
}

/**
 * Exchange authorization code for tokens and save to settings
 */
export async function handleAuthCallback(code: string, origin?: string) {
  const oauth2Client = await getOAuthClient(origin);
  const { tokens } = await oauth2Client.getToken(code);

  // Save tokens to settings
  await prisma.settings.update({
    where: { id: "singleton" },
    data: {
      googleAccessToken: tokens.access_token || null,
      googleRefreshToken: tokens.refresh_token || null,
      googleTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      googleSyncEnabled: true,
    },
  });

  return tokens;
}

/**
 * Custom error class for Google Calendar authentication errors
 */
export class GoogleAuthError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/**
 * Check if an error is an authentication error that requires re-authentication
 */
function isAuthError(error: any): boolean {
  if (!error) return false;

  const errorMessage = error.message?.toLowerCase() || "";
  const errorCode = error.code?.toLowerCase() || "";

  // Check for common auth error patterns
  return (
    errorMessage.includes("invalid_grant") ||
    errorMessage.includes("invalid credentials") ||
    errorMessage.includes("token has been expired or revoked") ||
    errorCode === "401" ||
    errorCode === "403" ||
    error.response?.status === 401 ||
    error.response?.status === 403
  );
}

/**
 * Clear invalid Google tokens from database
 */
async function clearGoogleTokens() {
  console.log("[GoogleCalendar] Clearing invalid tokens...");
  await prisma.settings.update({
    where: { id: "singleton" },
    data: {
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiresAt: null,
      googleSyncEnabled: false,
    },
  });
}

/**
 * Refresh access token if expired
 */
async function refreshTokenIfNeeded(oauth2Client: any) {
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
  });

  if (!settings?.googleTokenExpiresAt) return;

  const now = new Date();
  const expiresAt = new Date(settings.googleTokenExpiresAt);

  // Refresh if expired or expiring within 5 minutes
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    console.log("[GoogleCalendar] Refreshing access token...");
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();

      await prisma.settings.update({
        where: { id: "singleton" },
        data: {
          googleAccessToken: credentials.access_token || null,
          googleTokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
        },
      });
    } catch (error) {
      // If refresh fails due to auth error, clear tokens and throw
      if (isAuthError(error)) {
        await clearGoogleTokens();
        throw new GoogleAuthError(
          "Google Calendar connection expired. Please reconnect.",
          error
        );
      }
      // Re-throw other errors
      throw error;
    }
  }
}

/**
 * List all available calendars
 */
export async function listCalendars() {
  try {
    const oauth2Client = await getOAuthClient();
    await refreshTokenIfNeeded(oauth2Client);

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const response = await calendar.calendarList.list();

    return response.data.items || [];
  } catch (error) {
    // If auth error, clear tokens and throw GoogleAuthError
    if (isAuthError(error)) {
      await clearGoogleTokens();
      throw new GoogleAuthError(
        "Google Calendar connection expired. Please reconnect.",
        error
      );
    }
    throw error;
  }
}

/**
 * Fetch events from specified calendars
 */
export async function fetchCalendarEvents(
  calendarIds: string[],
  timeMin?: Date,
  timeMax?: Date
) {
  try {
    const oauth2Client = await getOAuthClient();
    await refreshTokenIfNeeded(oauth2Client);

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const allEvents: any[] = [];

    for (const calendarId of calendarIds) {
      try {
        const response = await calendar.events.list({
          calendarId,
          timeMin: timeMin?.toISOString() || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // Default: 1 year ago
          timeMax: timeMax?.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
        });

        const events = response.data.items || [];

        // Get calendar name
        const calendarInfo = await calendar.calendars.get({ calendarId });
        const calendarName = calendarInfo.data.summary || calendarId;

        for (const event of events) {
          // Skip birthday events at fetch time
          if (event.eventType === "birthday") {
            console.log(`[GoogleCalendar] Skipping birthday event during fetch: ${event.summary}`);
            continue;
          }
          if (event.source?.title === "Birthdays" || event.source?.title?.includes("Contacts")) {
            console.log(`[GoogleCalendar] Skipping contacts/birthday event during fetch: ${event.summary}`);
            continue;
          }

          allEvents.push({
            ...event,
            calendarId,
            calendarName,
          });
        }
      } catch (error) {
        // Check if this is an auth error
        if (isAuthError(error)) {
          await clearGoogleTokens();
          throw new GoogleAuthError(
            "Google Calendar connection expired. Please reconnect.",
            error
          );
        }
        console.error(`[GoogleCalendar] Error fetching events from ${calendarId}:`, error);
      }
    }

    return allEvents;
  } catch (error) {
    // If auth error at the top level, clear tokens and throw
    if (isAuthError(error)) {
      await clearGoogleTokens();
      throw new GoogleAuthError(
        "Google Calendar connection expired. Please reconnect.",
        error
      );
    }
    throw error;
  }
}

/**
 * Sync calendar events to database
 */
export async function syncCalendarEvents() {
  // Check if sync is already in progress
  if (syncInProgress) {
    console.log("[GoogleCalendar] Sync already in progress, skipping...");
    throw new Error("Sync already in progress");
  }

  syncInProgress = true;
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings?.googleCalendarIds) {
      throw new Error("No calendars selected for sync");
    }

    const calendarIds = JSON.parse(settings.googleCalendarIds) as string[];
    console.log(`[GoogleCalendar] Syncing ${calendarIds.length} calendars...`);

    // Fetch events
    const events = await fetchCalendarEvents(calendarIds);
    console.log(`[GoogleCalendar] Fetched ${events.length} events`);

    let created = 0;
    let updated = 0;

    for (const event of events) {
      if (!event.id || !event.start) continue;

      // Skip cancelled events
      if (event.status === "cancelled") continue;

      // Skip birthday events (from Google Contacts)
      // Birthday events typically have eventType: "birthday" or source.title includes "Birthdays"
      if (event.eventType === "birthday") {
        console.log(`[GoogleCalendar] Skipping birthday event: ${event.summary}`);
        continue;
      }

      // Also check if the event source indicates it's from contacts/birthdays
      if (event.source?.title === "Birthdays" || event.source?.title?.includes("Contacts")) {
        console.log(`[GoogleCalendar] Skipping contacts/birthday event: ${event.summary}`);
        continue;
      }

      const startTime = event.start.dateTime || event.start.date;
      const endTime = event.end?.dateTime || event.end?.date || startTime;

      if (!startTime) continue;

      // Check if event exists
      const existing = await prisma.calendarEvent.findUnique({
        where: { eventId: event.id },
      });

      const eventData = {
        eventId: event.id,
        calendarId: event.calendarId,
        calendarName: event.calendarName,
        title: event.summary || "(No title)",
        description: event.description || null,
        location: event.location || null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        attendees: event.attendees ? JSON.stringify(event.attendees) : null,
        recurringEventId: event.recurringEventId || null,
        htmlLink: event.htmlLink || null,
      };

      if (existing) {
        await prisma.calendarEvent.update({
          where: { id: existing.id },
          data: eventData,
        });
        updated++;
      } else {
        await prisma.calendarEvent.create({
          data: eventData,
        });
        created++;
      }
    }

    // Update last synced timestamp
    await prisma.settings.update({
      where: { id: "singleton" },
      data: { googleLastSynced: new Date() },
    });

    console.log(`[GoogleCalendar] Sync complete: ${created} created, ${updated} updated`);

    return { created, updated, total: events.length };
  } finally {
    syncInProgress = false;
  }
}

/**
 * Index calendar events (create embeddings and chunks)
 * @param onlyNew - If true, only index events that haven't been indexed yet OR have been updated since last embedding
 */
export async function indexCalendarEvents(onlyNew: boolean = false) {
  // Check if indexing is already in progress
  if (indexInProgress) {
    console.log("[GoogleCalendar] Indexing already in progress, skipping...");
    throw new Error("Indexing already in progress");
  }

  indexInProgress = true;
  try {
    console.log("[GoogleCalendar] Starting event indexing...");

    // Get all calendar events (or filter for unindexed)
    let events = await prisma.calendarEvent.findMany({
      orderBy: { startTime: "desc" },
    });

    // If onlyNew, filter to only unindexed or changed events
    if (onlyNew) {
      events = events.filter((event) => {
        // Never indexed
        if (!event.lastEmbedded || !event.embeddingVersion) {
          return true;
        }
        // Changed since last embedding (event moved, title changed, etc.)
        if (event.updatedAt && event.lastEmbedded && event.updatedAt > event.lastEmbedded) {
          return true;
        }
        return false;
      });
    }

    console.log(`[GoogleCalendar] Indexing ${events.length} events${onlyNew ? " (new/changed only)" : " (full reindex)"}`);

    let indexed = 0;

    for (const event of events) {
      try {
        // Verify the event still exists (in case it was deleted during processing)
        const eventExists = await prisma.calendarEvent.findUnique({
          where: { id: event.id },
        });

        if (!eventExists) {
          console.log(`[GoogleCalendar] Event ${event.id} no longer exists, skipping indexing`);
          continue;
        }

        // Create searchable content from event
        const attendeeList = event.attendees
          ? JSON.parse(event.attendees).map((a: any) => a.email || a.displayName).join(", ")
          : "";

        const content = `
Event: ${event.title}
Calendar: ${event.calendarName || "Unknown"}
Start: ${event.startTime.toLocaleString()}
End: ${event.endTime.toLocaleString()}
${event.location ? `Location: ${event.location}` : ""}
${attendeeList ? `Attendees: ${attendeeList}` : ""}
${event.description ? `Description: ${event.description}` : ""}
`.trim();

        // Generate embedding
        const embedding = await generateEmbedding(content);

        // Delete existing chunks for this event
        await prisma.documentChunk.deleteMany({
          where: { eventId: event.id },
        });

        const filePath = `calendar/${event.calendarId}/${event.eventId}`;
        const now = new Date();

        // Create or update IndexedFile entry for this event
        await prisma.indexedFile.upsert({
          where: { filePath },
          update: {
            chunkCount: 1,
            lastIndexed: now,
            status: "indexed",
          },
          create: {
            filePath,
            fileHash: event.id, // Use event ID as hash
            chunkCount: 1,
            lastIndexed: now,
            lastModified: event.updatedAt || now,
            status: "indexed",
            source: "google-calendar",
          },
        });

        // Create chunk using insertChunk from pgvector
        // Wrap in try-catch to handle foreign key constraint errors gracefully
        try {
          await insertChunk({
            content,
            embedding,
            source: "google-calendar",
            fileName: event.title,
            filePath,
            eventId: event.id,
            eventTitle: event.title,
            eventStartTime: event.startTime.toISOString(),
            eventEndTime: event.endTime.toISOString(),
            eventLocation: event.location || undefined,
            eventAttendees: attendeeList || undefined,
            calendarName: event.calendarName || undefined,
            chunkIndex: 0,
            totalChunks: 1,
          });
        } catch (insertError: any) {
          // If foreign key constraint error, the event was likely deleted during processing
          if (insertError.code === 'P2010' || insertError.message?.includes('foreign key constraint')) {
            console.log(`[GoogleCalendar] Event ${event.id} was deleted during indexing, skipping`);
            continue;
          }
          throw insertError;
        }

        // Update event embedding metadata
        await prisma.calendarEvent.update({
          where: { id: event.id },
          data: {
            embeddingVersion: 1,
            lastEmbedded: new Date(),
          },
        }).catch((updateError) => {
          // Event might have been deleted during processing
          console.log(`[GoogleCalendar] Could not update event ${event.id} metadata, may have been deleted`);
        });

        indexed++;

        if (indexed % 10 === 0) {
          console.log(`[GoogleCalendar] Indexed ${indexed}/${events.length} events`);
        }
      } catch (error) {
        console.error(`[GoogleCalendar] Error indexing event ${event.id}:`, error);
      }
    }

    console.log(`[GoogleCalendar] Indexing complete: ${indexed} events indexed`);

    return indexed;
  } finally {
    indexInProgress = false;
  }
}

/**
 * Disconnect Google Calendar (clear credentials)
 */
export async function disconnectGoogleCalendar() {
  await prisma.settings.update({
    where: { id: "singleton" },
    data: {
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiresAt: null,
      googleCalendarIds: null,
      googleSyncEnabled: false,
    },
  });
}

/**
 * Check if Google Calendar is configured and authenticated
 */
export async function isGoogleCalendarConfigured(): Promise<boolean> {
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
  });

  return !!(
    settings?.googleClientId &&
    settings?.googleClientSecret &&
    settings?.googleAccessToken
  );
}

/**
 * Get upcoming events (real-time API query, not from database)
 */
export async function getUpcomingEvents(
  days: number = 7,
  startDate?: string,
  endDate?: string
) {
  try {
    const oauth2Client = await getOAuthClient();
    await refreshTokenIfNeeded(oauth2Client);

    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings?.googleCalendarIds) {
      throw new Error("No calendars selected");
    }

    const calendarIds = JSON.parse(settings.googleCalendarIds) as string[];

    // Determine time range
    let timeMin: Date;
    let timeMax: Date;

    if (startDate) {
      // If startDate is provided, parse it
      timeMin = new Date(startDate);
      // Set to start of day in local timezone
      timeMin.setHours(0, 0, 0, 0);
    } else {
      // Default to now
      timeMin = new Date();
    }

    if (endDate) {
      // If endDate is provided, parse it
      timeMax = new Date(endDate);
      // Set to end of day in local timezone
      timeMax.setHours(23, 59, 59, 999);
    } else {
      // Use days parameter to calculate end date from start
      timeMax = new Date(timeMin.getTime() + days * 24 * 60 * 60 * 1000);
    }

    const events = await fetchCalendarEvents(calendarIds, timeMin, timeMax);

    return events.filter((e) => e.status !== "cancelled");
  } catch (error) {
    // If auth error, clear tokens and throw
    if (isAuthError(error)) {
      await clearGoogleTokens();
      throw new GoogleAuthError(
        "Google Calendar connection expired. Please reconnect.",
        error
      );
    }
    throw error;
  }
}

/**
 * Validate that the current Google Calendar connection is working
 * Returns true if connected and working, false otherwise
 */
export async function validateConnection(): Promise<{ valid: boolean; error?: string }> {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
    });

    // Check if we have credentials configured
    if (!settings?.googleClientId || !settings?.googleClientSecret) {
      return { valid: false, error: "not_configured" };
    }

    // Check if we have tokens
    if (!settings?.googleAccessToken) {
      return { valid: false, error: "not_authenticated" };
    }

    // Try to make a simple API call to validate the tokens
    const oauth2Client = await getOAuthClient();
    await refreshTokenIfNeeded(oauth2Client);

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Make a lightweight API call to test the connection
    await calendar.calendarList.list({ maxResults: 1 });

    return { valid: true };
  } catch (error) {
    console.error("[GoogleCalendar] Connection validation failed:", error);

    // If it's an auth error, clear tokens
    if (isAuthError(error)) {
      await clearGoogleTokens();
      return { valid: false, error: "auth_expired" };
    }

    // Other errors might be temporary (network issues, etc.)
    return { valid: false, error: error instanceof Error ? error.message : "unknown_error" };
  }
}
