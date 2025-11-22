# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml* ./

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application
RUN pnpm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml* ./

# Copy Prisma schema to a separate location (will be copied to mounted volume on startup)
COPY prisma ./prisma-schema

# Install all dependencies (including prisma CLI)
RUN pnpm install --frozen-lockfile

# Generate Prisma client using the schema from prisma-schema
RUN npx prisma generate --schema=./prisma-schema/schema.prisma

# Remove dev dependencies after generating Prisma client
RUN pnpm prune --prod

# Copy built application from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

# Create necessary directories for volumes
RUN mkdir -p /app/documents/File\ Uploads /app/documents/Sync\ Files /app/prisma

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/status', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Start script that runs migrations and starts the app
ENTRYPOINT ["docker-entrypoint.sh"]
