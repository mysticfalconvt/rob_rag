#!/bin/sh
set -e

# Copy schema.prisma and migrations to mounted volume if they don't exist
if [ ! -f /app/prisma/schema.prisma ]; then
  echo "Copying Prisma schema and migrations to mounted volume..."
  cp /app/prisma-schema/schema.prisma /app/prisma/schema.prisma
  cp -r /app/prisma-schema/migrations /app/prisma/migrations 2>/dev/null || true
fi

# Run Prisma migrations using the installed version (not npx)
echo "Running Prisma migrations..."
pnpm exec prisma migrate deploy

# Start the application
echo "Starting application..."
exec pnpm start
