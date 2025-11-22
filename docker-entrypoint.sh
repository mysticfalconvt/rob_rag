#!/bin/sh
set -e

# Copy schema.prisma to mounted volume if it doesn't exist
if [ ! -f /app/prisma/schema.prisma ]; then
  echo "Copying Prisma schema to mounted volume..."
  cp /app/prisma-schema/schema.prisma /app/prisma/schema.prisma
fi

# Run Prisma migrations
echo "Running Prisma migrations..."
npx prisma migrate deploy

# Start the application
echo "Starting application..."
exec pnpm start
