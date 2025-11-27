#!/bin/sh
set -e

# Create Prisma directory if it doesn't exist
mkdir -p /app/prisma/migrations

# Always sync schema and migrations from the image to the mounted volume
# This ensures new migrations are available after image updates
echo "Syncing Prisma schema and migrations..."
cp /app/prisma-schema/schema.prisma /app/prisma/schema.prisma
cp -r /app/prisma-schema/migrations/* /app/prisma/migrations/ 2>/dev/null || true

# Backup database before migrations (if it exists)
if [ -f /app/prisma/dev.db ]; then
    echo "Backing up database..."
    BACKUP_FILE="/app/prisma/dev.db.backup.$(date +%Y%m%d_%H%M%S)"
    cp /app/prisma/dev.db "$BACKUP_FILE"
    echo "Backup created: $BACKUP_FILE"

    # Keep only last 5 backups to save space
    ls -t /app/prisma/dev.db.backup.* 2>/dev/null | tail -n +6 | xargs -r rm
    echo "Old backups cleaned up (keeping last 5)"
fi

# Verify database connection
echo "Verifying database connection..."
if [ -f /app/prisma/dev.db ]; then
    echo "Database file found at /app/prisma/dev.db"
else
    echo "No existing database found - will create new database"
fi

# Show current migration status
echo "Checking migration status..."
MIGRATE_STATUS_OUTPUT=$(pnpm exec prisma migrate status 2>&1) || true
echo "$MIGRATE_STATUS_OUTPUT"

# Check if we need to baseline (database exists but no migrations recorded)
if echo "$MIGRATE_STATUS_OUTPUT" | grep -q "Following migrations have not yet been applied"; then
    if [ -f /app/prisma/dev.db ]; then
        # Database exists with data but no migration history - need to baseline
        echo "================================"
        echo "Database exists without migration history"
        echo "Baselining database with current schema..."
        echo "================================"

        # Mark all migrations as applied without running them
        # This tells Prisma "these migrations were already applied before we started tracking"
        pnpm exec prisma migrate resolve --applied 20251121111240_init
        pnpm exec prisma migrate resolve --applied 20251121130325_add_conversations
        pnpm exec prisma migrate resolve --applied 20251121205308_add_settings_model
        pnpm exec prisma migrate resolve --applied 20251121215538_add_paperless_ngx_support
        pnpm exec prisma migrate resolve --applied 20251121222629_add_paperless_external_url
        pnpm exec prisma migrate resolve --applied 20251122160636_add_goodreads_tables
        pnpm exec prisma migrate resolve --applied 20251126185425_add_fast_chat_model

        echo "Baseline complete. Now checking for any new migrations..."
    fi
fi

# Run migrations (will only apply new ones after baseline)
echo "Running database migrations..."
if ! pnpm exec prisma migrate deploy; then
    echo "================================"
    echo "ERROR: Migration failed!"
    echo "================================"
    if [ -f "$BACKUP_FILE" ]; then
        echo "Database backup available at: $BACKUP_FILE"
        echo "To restore: cp $BACKUP_FILE /app/prisma/dev.db"
    fi
    echo "Check logs above for details."
    exit 1
fi

echo "================================"
echo "Migrations completed successfully"
echo "================================"

# Start the application
echo "Starting application..."
exec pnpm start
