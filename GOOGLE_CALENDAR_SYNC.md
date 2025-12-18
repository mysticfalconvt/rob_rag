# Google Calendar Sync & Query Flow

## How It Works

### 1. **Initial Setup** (One-time)
1. Go to `/config` page
2. Enter Google OAuth credentials
3. Authenticate with Google
4. Select which calendars to sync
5. Click "Sync & Index Calendar Events"

This initial sync will:
- Fetch all events from Google Calendar API
- Store them in `CalendarEvent` table
- Generate embeddings for all events
- Create searchable `DocumentChunk` records
- Create `IndexedFile` records for the files page

**Time**: ~9-10 minutes for 5,814 events

---

## 2. **Ongoing Sync** (Regular updates)

### When to Sync
Click "Sync & Index Calendar Events" on `/config` page whenever you want to:
- Pull new events from Google Calendar
- Update changed events
- Get events that were added/modified since last sync

### What Happens During Sync

**Step 1: Sync from Google API** (Fast)
```typescript
syncCalendarEvents()
```
- Fetches all events from Google Calendar API
- For each event:
  - ✅ If exists in DB → **Update** (only if changed)
  - ✅ If new → **Create** new CalendarEvent
- Updates `googleLastSynced` timestamp

**Step 2: Incremental Indexing** (Only processes new/changed)
```typescript
indexCalendarEvents(onlyNew: true)
```
- ✅ Only indexes events where `lastEmbedded` is null
- Skips already-indexed events (no wasted API calls!)
- Generates embeddings only for new/changed events
- Creates IndexedFile and DocumentChunk records

**Result**: Much faster than initial sync! Only processes what's new.

---

## 3. **Querying Calendar Events**

### Two Query Methods

#### A. **Indexed Search** (Historical events)
Uses the embedded database of events for semantic search.

**When to use:**
- "What meetings did I have with John last month?"
- "Find all events about the project in Q4"
- "When was my dentist appointment?"

**How it works:**
- Searches indexed `DocumentChunk` records
- Uses vector similarity for semantic matching
- Fast and doesn't hit Google API
- Limited to what's been synced/indexed

**Available Tools for LLM:**
- `search_calendar_by_date` - Search by date range
- `search_calendar_by_attendee` - Find events with specific people
- `search_calendar_by_location` - Search by event location

#### B. **Real-Time Query** (Upcoming events)
Bypasses the index and queries Google Calendar API directly.

**When to use:**
- "What's on my calendar today?"
- "What meetings do I have this week?"
- "Show me my upcoming events"

**How it works:**
- Calls `getUpcomingEvents()` → Google Calendar API
- Always returns fresh, real-time data
- No indexing lag
- Limited to upcoming events (default: next 7 days)

**Available Tool for LLM:**
- `get_upcoming_events` - Real-time query from Google API

---

## 4. **Optimizations & Efficiency**

### ✅ What's Efficient
1. **Sync is smart**: Uses upsert logic, only updates what changed
2. **Incremental indexing**: Only generates embeddings for new events
3. **Real-time queries**: Bypass index for "what's happening now" queries
4. **No duplicate processing**: Tracks `lastEmbedded` to avoid re-indexing

### ❌ When Things Might Be Slow
1. **Initial sync**: Must process all historical events (one-time cost)
2. **Full reindex**: If you call `indexCalendarEvents(false)`, it reprocesses everything
3. **Large calendars**: Thousands of events = longer initial sync

### 💡 Best Practices
1. **Sync periodically**: Daily or weekly is usually enough
2. **Use real-time queries** for "what's next" type questions
3. **Use indexed search** for historical queries
4. **Avoid full reindexing** unless embeddings are corrupted

---

## 5. **Does Asking Questions Fetch New Events?**

**Short answer: No**

When you ask a question:
- The LLM uses available **tools** to query data
- Tools query the **indexed database** (not Google API)
- Exception: `get_upcoming_events` tool does hit Google API for real-time data

**To get new events into the index:**
- You must manually click "Sync & Index" on `/config` page
- Or implement a scheduled background job (not currently implemented)

---

## 6. **Future Enhancements** (Not Implemented)

Possible improvements:
1. **Auto-sync on schedule**: Cron job to sync daily
2. **Webhook updates**: Google Calendar push notifications for instant updates
3. **Selective indexing**: Only index events from the last year
4. **Delta sync**: Use Google's `syncToken` for truly incremental API queries
5. **Background indexing**: Queue new events for async embedding generation

---

## Summary

**Current Flow:**
```
User clicks "Sync & Index"
  ↓
Fetch all events from Google API (upsert logic)
  ↓
Index only new/changed events (incremental)
  ↓
Done! New events now searchable
```

**Query Flow:**
```
User asks question
  ↓
LLM decides which tool to use
  ↓
Historical query → Indexed database
Upcoming query → Google API (real-time)
  ↓
Return results
```

**Key Takeaway**: Sync is manual but efficient. Indexing only processes what's new. Real-time queries available for fresh data.
