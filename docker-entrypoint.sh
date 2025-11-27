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
pnpm exec prisma migrate status || true

# Run migrations
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
