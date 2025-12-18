# Quick Start: Automated Syncing in 5 Minutes

## 1. Generate Webhook Secret

```bash
openssl rand -hex 32
```

Copy the output.

---

## 2. Add to .env

```bash
WEBHOOK_SECRET=paste-your-secret-here
```

---

## 3. Deploy Your App

```bash
git add .
git commit -m "Add webhook endpoint for automated syncing"
git push
```

Wait for deployment to complete.

---

## 4. Test the Webhook

```bash
curl -X POST https://your-app.com/api/webhooks/sync-all \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"sources": ["google-calendar"]}'
```

You should see:
```json
{
  "success": true,
  "message": "Sync completed",
  ...
}
```

---

## 5. Set Up Cron Job on cron-job.org

1. Go to https://cron-job.org/en/signup.php
2. Sign up (free)
3. Click "Create cronjob"
4. Fill in:
   - **Title:** Sync Calendar
   - **URL:** `https://your-app.com/api/webhooks/sync-all`
   - **Schedule type:** Every day
   - **Execution time:** 03:00 (3 AM)
   - **Timezone:** Your timezone
5. Click "Advanced" tab
6. Add **Request headers:**
   ```
   Authorization: Bearer YOUR_WEBHOOK_SECRET
   Content-Type: application/json
   ```
7. Add **Request body:**
   ```json
   {"sources": ["google-calendar"]}
   ```
8. Save!

---

## Done! 🎉

Your calendar will now sync automatically every night at 3 AM.

**Check it's working:**
- Look at cron-job.org dashboard after 3 AM
- Check for 200 OK response
- View execution log

---

## Bonus: Manual Trigger Anytime

```bash
curl -X POST https://your-app.com/api/webhooks/sync-all \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json"
```

Or create a bookmark/shortcut for one-click sync!

---

## Other Options

### GitHub Actions (Free)
See `WEBHOOK_SCHEDULING.md` for GitHub Actions workflow example.

### Your Own Server Cron
```bash
crontab -e
# Add:
0 3 * * * curl -X POST https://your-app.com/api/webhooks/sync-all -H "Authorization: Bearer YOUR_SECRET" -H "Content-Type: application/json"
```

---

## Troubleshooting

**401 Unauthorized:**
- Check WEBHOOK_SECRET in .env matches the one in curl command

**500 Error:**
- Check app logs
- Make sure Google Calendar is configured in /config

**Nothing happens:**
- Check cron-job.org execution history
- Verify URL is correct
- Test manually with curl first

---

## Full Documentation

See `WEBHOOK_SCHEDULING.md` for complete details.
