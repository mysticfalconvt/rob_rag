#!/bin/sh
set -e

# Copy the schema and migrations baked into the image onto the mounted volume,
# so new migrations are available after an image update.
mkdir -p /app/prisma/migrations
echo "Syncing Prisma schema and migrations..."
cp /app/prisma-schema/schema.prisma /app/prisma/schema.prisma
cp -r /app/prisma-schema/migrations/* /app/prisma/migrations/ 2>/dev/null || true

# Current migration status (informational).
echo "Checking migration status..."
pnpm exec prisma migrate status || true

# Apply pending migrations. Stop the container if this fails, rather than
# starting the app against a half-migrated database.
echo "Running database migrations..."
if ! pnpm exec prisma migrate deploy; then
    echo "================================"
    echo "ERROR: Migration failed! Check the output above."
    echo "================================"
    exit 1
fi

# Drift check, read-only: compare the live database with schema.prisma.
# Exit codes from `migrate diff --exit-code`: 0 = in sync, 2 = differs, 1 = error.
echo "Checking for schema drift..."
set +e
pnpm exec prisma migrate diff \
    --from-schema-datasource /app/prisma/schema.prisma \
    --to-schema-datamodel /app/prisma/schema.prisma \
    --exit-code > /dev/null
DRIFT=$?
set -e

if [ "$DRIFT" -eq 0 ]; then
    echo "Schema is in sync with database"
elif [ "$DRIFT" -eq 2 ]; then
    echo "================================"
    echo "Schema drift detected - synchronizing..."
    echo "================================"
    # No --accept-data-loss: additive drift is fixed automatically, but a
    # change that would drop data stops the deploy for a human to look at.
    if ! pnpm exec prisma db push --skip-generate; then
        echo "ERROR: Could not sync schema drift without data loss. Resolve it with a migration."
        exit 1
    fi
    echo "Schema drift resolved"
else
    echo "ERROR: Drift check failed (prisma migrate diff exit code $DRIFT)"
    exit 1
fi

echo "================================"
echo "Migrations completed successfully"
echo "================================"

echo "Starting application..."
exec pnpm start
