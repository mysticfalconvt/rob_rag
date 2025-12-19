import { google } from "googleapis";
import prisma from "./prisma";
import { generateEmbedding } from "./ai";
import { insertChunk } from "./pgvector";

/**
 * Get redirect URI from environment or construct from request origin
 */
function getRedirectUri(origin?: string): string {
  // If GOOGLE_REDIRECT_URI is set, use it
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }

  // Otherwise, construct from origin or default to localhost
  const baseUrl = origin || "http://localhost:3000";
  return `${baseUrl}/api/google/auth/callback`;
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
    const { credentials } = await oauth2Client.refreshAccessToken();

    await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        googleAccessToken: credentials.access_token || null,
        googleTokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      },
    });
  }
}

/**
 * List all available calendars
 */
export async function listCalendars() {
  const oauth2Client = await getOAuthClient();
  await refreshTokenIfNeeded(oauth2Client);

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const response = await calendar.calendarList.list();

  return response.data.items || [];
}

/**
 * Fetch events from specified calendars
 */
export async function fetchCalendarEvents(
  calendarIds: string[],
  timeMin?: Date,
  timeMax?: Date
) {
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
        allEvents.push({
          ...event,
          calendarId,
          calendarName,
        });
      }
    } catch (error) {
      console.error(`[GoogleCalendar] Error fetching events from ${calendarId}:`, error);
    }
  }

  return allEvents;
}

/**
 * Sync calendar events to database
 */
export async function syncCalendarEvents() {
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
}

/**
 * Index calendar events (create embeddings and chunks)
 * @param onlyNew - If true, only index events that haven't been indexed yet OR have been updated since last embedding
 */
export async function indexCalendarEvents(onlyNew: boolean = false) {
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

      // Update event embedding metadata
      await prisma.calendarEvent.update({
        where: { id: event.id },
        data: {
          embeddingVersion: 1,
          lastEmbedded: new Date(),
        },
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
export async function getUpcomingEvents(days: number = 7) {
  const oauth2Client = await getOAuthClient();
  await refreshTokenIfNeeded(oauth2Client);

  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
  });

  if (!settings?.googleCalendarIds) {
    throw new Error("No calendars selected");
  }

  const calendarIds = JSON.parse(settings.googleCalendarIds) as string[];
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const events = await fetchCalendarEvents(calendarIds, now, future);

  return events.filter((e) => e.status !== "cancelled");
}
