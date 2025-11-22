# Goodreads RSS Feed Automated Syncing

The Goodreads integration includes an API endpoint for syncing all RSS feeds automatically.

## Endpoint

`POST /api/goodreads/sync-all`

This endpoint syncs RSS feeds for all configured users.

## Scheduling Options

### Option 1: Linux Cron Job

Add to your crontab (`crontab -e`):

```bash
# Sync Goodreads RSS feeds daily at 6 AM
0 6 * * * curl -X POST http://localhost:3000/api/goodreads/sync-all
```

### Option 2: systemd Timer (Linux)

Create `/etc/systemd/system/goodreads-sync.service`:

```ini
[Unit]
Description=Sync Goodreads RSS Feeds

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -X POST http://localhost:3000/api/goodreads/sync-all
```

Create `/etc/systemd/system/goodreads-sync.timer`:

```ini
[Unit]
Description=Run Goodreads RSS sync daily

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start:
```bash
sudo systemctl enable goodreads-sync.timer
sudo systemctl start goodreads-sync.timer
```

### Option 3: Docker with Cron

If running in Docker, you can add a cron container:

**docker-compose.yml:**
```yaml
services:
  cron:
    image: alpine:latest
    command: >
      sh -c "echo '0 6 * * * wget -O- -q http://app:3000/api/goodreads/sync-all' | crontab - && crond -f"
    depends_on:
      - app
```

### Option 4: Node.js Scheduled Task

Install node-cron:
```bash
pnpm add node-cron @types/node-cron
```

Create `lib/scheduler.ts`:
```typescript
import cron from 'node-cron';

export function startScheduler() {
  // Run daily at 6 AM
  cron.schedule('0 6 * * *', async () => {
    console.log('Running scheduled Goodreads RSS sync...');
    try {
      const response = await fetch('http://localhost:3000/api/goodreads/sync-all', {
        method: 'POST',
      });
      const data = await response.json();
      console.log('Sync complete:', data);
    } catch (error) {
      console.error('Scheduled sync failed:', error);
    }
  });

  console.log('Goodreads RSS sync scheduler started');
}
```

Then call `startScheduler()` in your app initialization.

### Option 5: External Cron Services

Use a service like:
- **cron-job.org** (free)
- **EasyCron** (free tier available)
- **GitHub Actions** (free for public repos)

Example GitHub Action (`.github/workflows/goodreads-sync.yml`):
```yaml
name: Sync Goodreads RSS

on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
  workflow_dispatch:  # Allow manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Sync
        run: |
          curl -X POST https://your-domain.com/api/goodreads/sync-all
```

## Recommended Schedule

- **Daily sync**: Recommended for active readers
- **Weekly sync**: Sufficient for casual readers
- **Manual sync**: Use the "Sync Now" button in the UI anytime

## Monitoring

Check logs for sync results:
```bash
# If using Docker
docker-compose logs app | grep Goodreads

# If running directly
# Check your application logs
```

## Security Note

For production deployments, consider adding authentication to the `/api/goodreads/sync-all` endpoint to prevent unauthorized access.
