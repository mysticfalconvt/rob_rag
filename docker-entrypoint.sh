#!/bin/sh
set -e

# Always sync schema and migrations from the image to the mounted volume
# This ensures new migrations are available after image updates
echo "Syncing Prisma schema and migrations..."
cp /app/prisma-schema/schema.prisma /app/prisma/schema.prisma

# Sync migrations directory (creates if doesn't exist, updates if it does)
mkdir -p /app/prisma/migrations
cp -r /app/prisma-schema/migrations/* /app/prisma/migrations/ 2>/dev/null || true

# Run Prisma migrations using the installed version (not npx)
# This applies any new migrations to the database
echo "Running Prisma migrations..."
pnpm exec prisma migrate deploy

# Start the application
echo "Starting application..."
exec pnpm start
