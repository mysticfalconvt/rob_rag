# Automated Sync with Webhooks

## Overview

This app now has a webhook endpoint that can sync all data sources automatically. You can trigger it from external cron services to run syncs on a schedule (e.g., nightly).

**Endpoint:** `POST /api/webhooks/sync-all`

---

## Setup

### 1. Add Webhook Secret to Environment

Add this to your `.env` file:

```bash
WEBHOOK_SECRET=your-secure-random-string-here
```

**Generate a secure secret:**
```bash
# Option 1: OpenSSL
openssl rand -hex 32

# Option 2: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Option 3: Online
# Use https://www.random.org/strings/ or similar
```

**Important:** Keep this secret safe! Anyone with this token can trigger syncs.

---

## Usage

### Basic Request

```bash
curl -X POST https://your-app.com/api/webhooks/sync-all \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json"
```

This will sync **all sources** (Google Calendar, Goodreads, Paperless).

### Sync Specific Sources Only

```bash
curl -X POST https://your-app.com/api/webhooks/sync-all \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"sources": ["google-calendar"]}'
```

**Available sources:**
- `google-calendar`
- `goodreads`
- `paperless`

### Example Response

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
    },
    "goodreads": {
      "success": true,
      "users": 2,
      "synced": 3,
      "indexed": 150
    },
    "paperless": {
      "success": true,
      "indexed": 12,
      "deleted": 0
    }
  }
}
```

---

## Scheduling Options

### Option 1: cron-job.org (Easiest, Free)

**Steps:**
1. Go to https://cron-job.org/
2. Create free account
3. Create new cron job:
   - **URL:** `https://your-app.com/api/webhooks/sync-all`
   - **Schedule:** `0 3 * * *` (3 AM daily)
   - **Method:** POST
   - **Headers:**
     - `Authorization: Bearer YOUR_WEBHOOK_SECRET`
     - `Content-Type: application/json`
   - **Body:** `{"sources": ["google-calendar", "goodreads", "paperless"]}`

**Pros:**
- Free tier available
- Simple UI
- Reliable
- Email notifications on failure

---

### Option 2: GitHub Actions (Free for public repos)

Create `.github/workflows/sync.yml`:

```yaml
name: Sync Data Sources

on:
  schedule:
    # Run at 3 AM UTC daily
    - cron: '0 3 * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Sync Webhook
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/webhooks/sync-all \
            -H "Authorization: Bearer ${{ secrets.WEBHOOK_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{"sources": ["google-calendar", "goodreads", "paperless"]}'
```

**Setup:**
1. Add repository secrets:
   - `APP_URL`: `https://your-app.com`
   - `WEBHOOK_SECRET`: Your webhook secret
2. Commit the workflow file
3. GitHub will run it on schedule

**Pros:**
- Free for public repos
- Integrated with GitHub
- Can trigger manually
- View logs easily

---

### Option 3: Vercel Cron Jobs (If deployed on Vercel)

Add to `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/webhooks/sync-all",
    "schedule": "0 3 * * *"
  }]
}
```

**Note:** This requires upgrading Vercel's cron feature. The webhook approach still works but you'd need to authenticate differently (maybe via internal token).

---

### Option 4: EasyCron (Alternative)

Similar to cron-job.org: https://www.easycron.com/

---

### Option 5: Your Own Server Cron

If you have a server with cron access:

```bash
# Edit crontab
crontab -e

# Add this line (3 AM daily)
0 3 * * * curl -X POST https://your-app.com/api/webhooks/sync-all -H "Authorization: Bearer YOUR_SECRET" -H "Content-Type: application/json"
```

---

## Recommended Schedule

### For Google Calendar
- **Frequency:** Every 4-6 hours or nightly
- **Reason:** Events change frequently (moved meetings, cancellations)
- **Example:** `0 */6 * * *` (every 6 hours)

### For Goodreads
- **Frequency:** Daily or weekly
- **Reason:** Books don't change that often
- **Example:** `0 4 * * *` (4 AM daily)

### For Paperless
- **Frequency:** Hourly or every few hours
- **Reason:** Documents get added throughout the day
- **Example:** `0 * * * *` (every hour)

### All Sources Together
- **Frequency:** Nightly
- **Example:** `0 3 * * *` (3 AM daily)

---

## Monitoring

### Success Indicators
- HTTP 200 response
- `success: true` in response body
- Check logs for "[Webhook] Sync complete"

### Failure Handling
- HTTP 401: Invalid webhook secret
- HTTP 500: Sync error (check logs)
- Setup email alerts in your cron service

### Logging
All webhook activity is logged with `[Webhook]` prefix:
```
[Webhook] Starting sync for sources: google-calendar, goodreads, paperless
[Webhook] Syncing Google Calendar...
[Webhook] Syncing Goodreads...
[Webhook] Syncing Paperless...
[Webhook] Sync complete: {...}
```

---

## Security

### Webhook Secret
- Store in `.env` file (never commit!)
- Use long, random string (32+ characters)
- Rotate periodically

### Authorization
The endpoint checks:
```typescript
Authorization: Bearer YOUR_WEBHOOK_SECRET
```

If missing or wrong: HTTP 401 Unauthorized

### Rate Limiting
Consider adding rate limiting if exposed publicly:
- Max 1 request per minute per source
- Use Vercel's built-in rate limiting or add middleware

---

## Testing

### Test the Endpoint Locally

```bash
# Start your dev server
pnpm dev

# In another terminal
curl -X POST http://localhost:3000/api/webhooks/sync-all \
  -H "Authorization: Bearer your-local-secret" \
  -H "Content-Type: application/json" \
  -d '{"sources": ["google-calendar"]}'
```

### Test with Production URL

```bash
curl -X POST https://your-production-app.com/api/webhooks/sync-all \
  -H "Authorization: Bearer your-production-secret" \
  -H "Content-Type: application/json" \
  -d '{"sources": ["google-calendar"]}'
```

---

## Comparison: In-App Cron vs External Webhook

### In-App Cron (Not Implemented)
**Pros:**
- Self-contained
- No external dependency

**Cons:**
- Requires always-running server
- Doesn't work on serverless (Vercel, Netlify)
- Harder to monitor/debug
- Can miss schedules if app crashes

### External Webhook (Recommended) ✅
**Pros:**
- Works on serverless platforms
- Reliable scheduling (external service)
- Easy to monitor (service UI)
- Can trigger manually anytime
- Multiple free options available

**Cons:**
- Requires external service
- Need to secure webhook endpoint

---

## Summary

**Easiest Setup:**
1. Add `WEBHOOK_SECRET` to `.env`
2. Deploy your app
3. Create cron job on cron-job.org
4. Point it to `https://your-app.com/api/webhooks/sync-all`
5. Done! ✅

**Recommended Schedule:**
```
0 3 * * *  # 3 AM daily - sync all sources
```

**One-liner test:**
```bash
curl -X POST https://your-app.com/api/webhooks/sync-all \
  -H "Authorization: Bearer $(grep WEBHOOK_SECRET .env | cut -d '=' -f2)" \
  -H "Content-Type: application/json"
```

Now your calendar events will be updated automatically every night! 🎉
