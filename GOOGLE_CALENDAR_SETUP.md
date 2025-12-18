# Google Calendar Integration Setup Guide

This guide walks you through setting up Google Calendar integration for your RAG application.

## Overview

The Google Calendar integration allows you to:
- **Query historical events** using semantic search (e.g., "What meetings did I have about the project?")
- **Search by metadata** (date ranges, attendees, locations)
- **Get real-time upcoming events** via direct API queries
- **Index events** into your RAG database for comprehensive searching

## Architecture

- **Hybrid Approach**: Combines indexed historical events with real-time API queries
- **Shared Calendar**: One set of credentials for all app users
- **Database Storage**: Calendar credentials stored in Settings singleton (not env vars)
- **Plugin System**: Fully integrated with existing data source plugin architecture

## Setup Instructions

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Calendar API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

### 2. Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Configure OAuth consent screen (if not already done):
   - User type: Internal (or External for personal use)
   - Add required info (app name, support email)
   - Scopes: Add `../auth/calendar.readonly`
4. Create OAuth Client ID:
   - Application type: **Web application**
   - Name: "RobRAG Calendar"
   - Authorized redirect URIs:
     - `http://localhost:3000/api/google/auth/callback` (for local dev)
     - `https://yourdomain.com/api/google/auth/callback` (for production)
5. Copy the **Client ID** and **Client Secret**

### 3. Configure in Application

1. Start your application: `pnpm dev`
2. Navigate to `/config` page (Configuration)
3. Scroll to "Google Calendar Integration" section
4. Enter your **Client ID** and **Client Secret**
5. Click "Save Credentials"

### 4. Authenticate with Google

1. Click "Connect to Google"
2. You'll be redirected to Google's OAuth consent screen
3. Sign in with your Google account
4. Grant calendar read permissions
5. You'll be redirected back to the status page

### 5. Select Calendars to Sync

1. Click "Load Calendars" to fetch your available calendars
2. Check the calendars you want to index
3. Click "Save Selection"

### 6. Sync and Index Events

1. Click "Sync Calendar Events"
2. This will:
   - Fetch events from selected calendars (past 1 year by default)
   - Store events in the database
   - Create embeddings for semantic search
   - Index events into the RAG system

## Usage

### Querying Calendar Events

Once synced, you can ask questions like:

**Historical/Semantic Queries** (uses indexed database):
- "What meetings did I have with John last month?"
- "Show me all events about the product launch"
- "When was my dentist appointment?"
- "What conferences did I attend in 2024?"

**Time-based Queries** (uses indexed database):
- "List all meetings in Q4 2024"
- "Show events in January"

**Real-time Queries** (uses live Google API):
- "What's on my calendar today?"
- "What meetings do I have this week?"
- "What's coming up in the next 7 days?"

### Available Tools

The calendar plugin provides these tools to the LLM:

1. **search_calendar_by_date**: Search by date range
2. **search_calendar_by_attendee**: Find events with specific people
3. **search_calendar_by_location**: Search by event location
4. **get_upcoming_events**: Real-time query for upcoming events (bypasses index)

## Configuration Options

### Environment Variables (Optional)

```env
# Override default redirect URI (optional)
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/auth/callback
```

### Sync Settings

- **Default lookback**: 1 year of historical events
- **Max events per calendar**: 2500
- **Sync frequency**: Manual (can be automated via cron/scheduled task)

### Periodic Sync

To keep events up-to-date, you can:

1. **Manual sync**: Click "Sync Calendar Events" on status page
2. **Scheduled sync**: Call the sync endpoint via cron:
   ```bash
   curl -X POST http://localhost:3000/api/google/sync \
     -H "Cookie: your-session-cookie"
   ```

## API Endpoints

- `GET /api/google/status` - Check configuration status
- `POST /api/google/credentials` - Save client credentials
- `GET /api/google/auth/login` - Initiate OAuth flow
- `GET /api/google/auth/callback` - OAuth callback handler
- `POST /api/google/auth/disconnect` - Disconnect and clear credentials
- `GET /api/google/calendars` - List available calendars
- `POST /api/google/calendars` - Save calendar selection
- `POST /api/google/sync` - Sync and index events

## Database Schema

### Settings Model (extended)
```prisma
googleClientId          String?
googleClientSecret      String?
googleRefreshToken      String?
googleAccessToken       String?
googleTokenExpiresAt    DateTime?
googleCalendarIds       String?    // JSON array
googleLastSynced        DateTime?
googleSyncEnabled       Boolean
```

### CalendarEvent Model
```prisma
model CalendarEvent {
  id           String   @id
  eventId      String   @unique
  calendarId   String
  calendarName String?
  title        String
  description  String?
  location     String?
  startTime    DateTime
  endTime      DateTime
  attendees    String?  // JSON
  ...
}
```

## Troubleshooting

### "OAuth error: invalid_grant"
- Credentials may have expired
- Click "Disconnect" and reconnect

### "Failed to fetch calendars"
- Ensure Calendar API is enabled in Google Cloud Console
- Check OAuth scopes include `calendar.readonly`

### No events showing up in search
- Run "Sync Calendar Events" to index events
- Check that calendars are selected in configuration

### Token refresh issues
- Tokens are automatically refreshed when expired
- If issues persist, disconnect and reconnect

## Security Notes

- Credentials stored in PostgreSQL database (Settings table)
- Access tokens have expiration and are auto-refreshed
- Only read-only calendar access (`calendar.readonly` scope)
- OAuth requires user consent for calendar access
- All endpoints require authentication

## Future Enhancements

Potential improvements:
- [ ] Automatic periodic sync (background job)
- [ ] Calendar-specific event filters
- [ ] Event creation/updates (write access)
- [ ] Calendar-specific indexing strategies
- [ ] Event reminder queries
- [ ] Integration with task management
