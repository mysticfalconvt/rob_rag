# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files. pnpm-workspace.yaml carries pnpm settings, including
# which packages may run install scripts (bcrypt, Prisma engines).
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./

# pnpm comes from corepack at the version pinned in package.json
# (packageManager), not whatever is latest on npm.
RUN corepack enable && pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma Client
RUN pnpm exec prisma generate

# Build the application
RUN pnpm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Install OpenSSL and other required dependencies for Prisma
# Also install GraphicsMagick and Ghostscript for pdf2pic OCR functionality
RUN apk add --no-cache openssl libc6-compat graphicsmagick ghostscript

# pnpm via corepack, pinned by package.json (packageManager)
RUN corepack enable

# Copy package files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy Prisma schema and migrations to a separate location (will be copied to mounted volume on startup)
COPY prisma ./prisma-schema

# Install production dependencies. The Prisma CLI is a regular dependency
# (docker-entrypoint.sh runs migrations with it), so it matches @prisma/client.
RUN pnpm install --prod --frozen-lockfile

# Generate Prisma client using the schema from prisma-schema
RUN pnpm exec prisma generate --schema=./prisma-schema/schema.prisma

# Copy built application from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

# Create necessary directories for volumes
RUN mkdir -p /app/documents/File\ Uploads /app/documents/Sync\ Files /app/documents/Custom_Docs/originals /app/documents/Custom_Docs/markdown /app/prisma

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Health check (longer start-period to allow for migrations)
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Start script that runs migrations and starts the app
ENTRYPOINT ["docker-entrypoint.sh"]
