#!/bin/sh
set -e

# Always sync schema and migrations from the image to the mounted volume
# This ensures new migrations are available after image updates
echo "Syncing Prisma schema and migrations..."
cp /app/prisma-schema/schema.prisma /app/prisma/schema.prisma

# Sync migrations directory (creates if doesn't exist, updates if it does)
mkdir -p /app/prisma/migrations
cp -r /app/prisma-schema/migrations/* /app/prisma/migrations/ 2>/dev/null || true

# Always run db push first to ensure schema is in sync
# This handles cases where migrations don't exist or schema has drifted
echo "Ensuring database schema is up to date with db push..."
pnpm exec prisma db push --skip-generate --accept-data-loss

# Then try to run any migrations (in case there are pending ones)
echo "Checking for pending migrations..."
pnpm exec prisma migrate deploy 2>/dev/null || echo "No migrations to apply or migrations already applied"

# Start the application
echo "Starting application..."
exec pnpm start
