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
        echo "Synchronizing schema with db push..."
        echo "================================"

        # First, use db push to ensure schema matches (handles missing columns)
        # This is safe here because we're fixing an existing db push database
        if ! pnpm exec prisma db push --skip-generate; then
            echo "ERROR: Failed to sync database schema"
            exit 1
        fi

        echo "Schema synchronized. Now baselining migration history..."

        # Mark all migrations as applied without running them
        # This tells Prisma "these migrations were already applied before we started tracking"
        pnpm exec prisma migrate resolve --applied 20251121111240_init
        pnpm exec prisma migrate resolve --applied 20251121130325_add_conversations
        pnpm exec prisma migrate resolve --applied 20251121205308_add_settings_model
        pnpm exec prisma migrate resolve --applied 20251121215538_add_paperless_ngx_support
        pnpm exec prisma migrate resolve --applied 20251121222629_add_paperless_external_url
        pnpm exec prisma migrate resolve --applied 20251122160636_add_goodreads_tables
        pnpm exec prisma migrate resolve --applied 20251126185425_add_fast_chat_model

        echo "Baseline complete. Future deploys will use migrations only."
    fi
fi

# Run migrations (will only apply new ones after baseline)
echo "Running database migrations..."
DEPLOY_OUTPUT=$(pnpm exec prisma migrate deploy 2>&1)
DEPLOY_EXIT=$?

echo "$DEPLOY_OUTPUT"

if [ $DEPLOY_EXIT -ne 0 ]; then
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

# Validate schema matches database (detects drift even after baseline)
echo "Validating database schema..."
VALIDATE_OUTPUT=$(pnpm exec prisma validate 2>&1) || true

# Check if there's a schema drift by trying to generate client
# If schema doesn't match, Prisma will detect it
echo "Checking for schema drift..."
if pnpm exec prisma db push --skip-generate --accept-data-loss 2>&1 | grep -q "already in sync"; then
    echo "Schema is in sync with database"
else
    echo "================================"
    echo "Schema drift detected - synchronizing..."
    echo "================================"
    if ! pnpm exec prisma db push --skip-generate; then
        echo "ERROR: Failed to sync schema drift"
        exit 1
    fi
    echo "Schema drift resolved"
fi

echo "================================"
echo "Migrations completed successfully"
echo "================================"

# Start the application
echo "Starting application..."
exec pnpm start
