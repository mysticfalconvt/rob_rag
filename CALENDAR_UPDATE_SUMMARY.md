# Calendar Update Summary

## What Changed

### 1. ✅ **Moved Events Now Get Updated**

**Problem:** When calendar events were moved/edited, the old indexed version stayed in the database.

**Solution:** Added change detection to incremental indexing:
```typescript
// Now checks if updatedAt > lastEmbedded
if (event.updatedAt && event.lastEmbedded && event.updatedAt > event.lastEmbedded) {
  return true; // Reindex this event
}
```

**Result:** Next sync will reindex any events that were moved/changed.

---

### 2. ✅ **Webhook Endpoint for Scheduled Syncing**

**New endpoint:** `POST /api/webhooks/sync-all`

**Purpose:** Trigger syncs from external cron services (easiest approach).

**Security:** Requires `WEBHOOK_SECRET` in Authorization header.

**Example usage:**
```bash
curl -X POST https://your-app.com/api/webhooks/sync-all \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"sources": ["google-calendar", "goodreads", "paperless"]}'
```

**What it does:**
- Syncs Google Calendar (fetch from API, update DB)
- Indexes only new/changed events (incremental)
- Can also sync Goodreads and Paperless
- Returns detailed results for each source

---

## Setup Guide

### Step 1: Add Webhook Secret

Add to your `.env`:
```bash
WEBHOOK_SECRET=your-secure-random-string-here
```

Generate a secure secret:
```bash
openssl rand -hex 32
```

### Step 2: Choose a Scheduling Service

**Recommended: cron-job.org (easiest, free)**

1. Go to https://cron-job.org/
2. Create free account
3. Create new cron job:
   - **URL:** `https://your-app.com/api/webhooks/sync-all`
   - **Schedule:** `0 3 * * *` (3 AM daily)
   - **Method:** POST
   - **Headers:**
     - `Authorization: Bearer YOUR_WEBHOOK_SECRET`
     - `Content-Type: application/json`
   - **Body:** `{"sources": ["google-calendar"]}`

### Step 3: Test It

```bash
curl -X POST https://your-app.com/api/webhooks/sync-all \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json"
```

---

## Recommended Schedules

### Conservative (Recommended)
```
0 3 * * *  # 3 AM daily - all sources
```

### Aggressive (More frequent updates)
```
0 */6 * * *  # Every 6 hours - Google Calendar only
0 4 * * *    # 4 AM daily - Goodreads
0 * * * *    # Every hour - Paperless
```

---

## Why Webhook Instead of In-App Cron?

### ✅ Webhook Approach (Implemented)
- **Works on serverless** (Vercel, Netlify, etc.)
- **Reliable** (external service handles scheduling)
- **Easy to monitor** (service has UI, logs, alerts)
- **Can trigger manually** anytime
- **Multiple free options** available

### ❌ In-App Cron (Not Implemented)
- Requires always-running server
- Doesn't work on serverless platforms
- Harder to debug
- Can miss schedules if app crashes

---

## What Happens During Overnight Sync?

### 1. Google Calendar
```
Fetch all events from Google API
  ↓
Update CalendarEvent records (upsert logic)
  ↓
Find events where:
  - lastEmbedded is null (new events)
  - updatedAt > lastEmbedded (moved/edited events)
  ↓
Generate embeddings only for those events
  ↓
Update IndexedFile and DocumentChunk
```

**Efficiency:**
- If you have 5,000 events and only 10 changed → only 10 embeddings generated
- Much faster than regenerating everything!

### 2. Goodreads (If included)
```
Fetch RSS feed for each user
  ↓
Import new/updated books
  ↓
Reindex ALL books (⚠️ not incremental yet)
```

**Note:** Goodreads still regenerates all embeddings. Could be optimized like Calendar.

### 3. Paperless (If included)
```
Fetch all documents from Paperless API
  ↓
Check hash for each document
  ↓
Only reindex if hash changed (✅ incremental)
```

**Efficiency:**
- Hash-based change detection
- Only reindexes modified documents

---

## Monitoring

### Success Response
```json
{
  "success": true,
  "message": "Sync completed",
  "timestamp": "2025-01-15T03:00:00.000Z",
  "sources": {
    "google-calendar": {
      "success": true,
      "synced": {
        "created": 5,
        "updated": 23,
        "total": 5820
      },
      "indexed": 28
    }
  }
}
```

### Check Logs
Look for:
```
[Webhook] Starting sync for sources: google-calendar
[Webhook] Syncing Google Calendar...
[GoogleCalendar] Syncing 1 calendars...
[GoogleCalendar] Fetched 5820 events
[GoogleCalendar] Sync complete: 5 created, 23 updated
[GoogleCalendar] Indexing 28 events (new/changed only)
[Webhook] Sync complete
```

---

## Files Created/Modified

### New Files
1. `/app/api/webhooks/sync-all/route.ts` - Webhook endpoint
2. `/WEBHOOK_SCHEDULING.md` - Full documentation
3. `/CALENDAR_UPDATE_SUMMARY.md` - This file

### Modified Files
1. `/lib/googleCalendar.ts` - Added change detection to incremental indexing
2. `/.env.example` - Added WEBHOOK_SECRET documentation

---

## Next Steps

1. **Add WEBHOOK_SECRET to your .env**
   ```bash
   echo "WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env
   ```

2. **Test the webhook locally**
   ```bash
   pnpm dev
   # In another terminal:
   curl -X POST http://localhost:3000/api/webhooks/sync-all \
     -H "Authorization: Bearer $(grep WEBHOOK_SECRET .env | cut -d '=' -f2)" \
     -H "Content-Type: application/json"
   ```

3. **Deploy your app**

4. **Set up cron-job.org** (or your preferred service)

5. **Test the production webhook**

6. **Enjoy automated syncing!** ✨

---

## FAQ

**Q: Will this reindex all 5,000+ events every night?**
A: No! Only new or changed events get reindexed.

**Q: What if the webhook fails?**
A: Most cron services have email alerts and retry logic.

**Q: Can I trigger it manually?**
A: Yes! Just run the curl command anytime.

**Q: Does this cost money?**
A: No! Most external cron services have free tiers. Only your app's hosting/API costs apply.

**Q: What about Goodreads and Paperless?**
A: They can be included in the same webhook. Paperless is already incremental. Goodreads could be optimized later.

**Q: Can I run different schedules for different sources?**
A: Yes! Create multiple cron jobs with different source filters:
- Job 1 (every 6 hours): `{"sources": ["google-calendar"]}`
- Job 2 (daily): `{"sources": ["goodreads", "paperless"]}`

---

## Summary

✅ Moved calendar events now get updated
✅ Webhook endpoint for easy scheduled syncing
✅ Works with any external cron service
✅ Incremental indexing (only processes changes)
✅ Secure with WEBHOOK_SECRET
✅ Easy to monitor and debug

**Recommended:** Set up nightly sync at 3 AM with cron-job.org (takes 5 minutes to configure).
