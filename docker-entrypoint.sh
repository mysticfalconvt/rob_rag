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
if pnpm exec prisma migrate deploy 2>&1 | tee /tmp/migrate.log; then
  echo "Migrations applied successfully"
else
  echo "Migration deploy failed or no migrations found"
  cat /tmp/migrate.log

  # Check if the error is about missing columns or schema drift
  if grep -q "does not exist in the current database" /tmp/migrate.log || \
     grep -q "P2022" /tmp/migrate.log || \
     [ ! -d "/app/prisma/migrations" ] || \
     [ -z "$(ls -A /app/prisma/migrations 2>/dev/null)" ]; then
    echo "Schema drift detected or no migrations exist. Using db push to sync schema..."
    pnpm exec prisma db push --skip-generate --accept-data-loss
  else
    echo "Migration failed for unknown reason. Exiting."
    exit 1
  fi
fi

# Start the application
echo "Starting application..."
exec pnpm start
