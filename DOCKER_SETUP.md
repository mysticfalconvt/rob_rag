# Docker Setup Guide

Simple guide for RobRAG with PostgreSQL + pgvector.

---

## Quick Start

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

---

## Services

Your docker-compose includes:

1. **app** - RobRAG application (port 4345)
2. **postgres-prod** - Production PostgreSQL with pgvector (internal only)
3. **postgres-dev** - Dev PostgreSQL with pgvector (port 4344, for local tools)

All services start with a single `docker compose up -d` command.

---

## Environment Variables

Add these to your `.env` file:

```bash
# PostgreSQL Credentials
POSTGRES_USER=robrag
POSTGRES_PASSWORD=your_secure_production_password_here
POSTGRES_DB=robrag_prod

# Dev Database (optional, for local development)
DEV_POSTGRES_USER=robrag
DEV_POSTGRES_PASSWORD=robrag_dev_password
DEV_POSTGRES_DB=robrag_dev

# LM Studio
LM_STUDIO_API_URL=http://your-lm-studio:1234/v1
LM_STUDIO_API_KEY=lm-studio

# Models
EMBEDDING_MODEL_NAME=nomic-embed-text
CHAT_MODEL_NAME=llama-3.2-1b-instruct

# App
APP_NAME=RobRAG
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme_in_production
ADMIN_NAME=Administrator

# Security
SESSION_SECRET=generate_with_openssl_rand_base64_32
```

Generate secure passwords:
```bash
openssl rand -base64 32
```

---

## Common Commands

### Start/Stop
```bash
# Start everything
docker compose up -d

# Stop everything
docker compose down

# Restart just the app
docker compose restart app

# View logs
docker compose logs -f app
```

### Database Access

#### PostgreSQL Dev (from your machine)
```bash
# Connect with psql (port 4344)
psql postgresql://robrag:robrag_dev_password@localhost:4344/robrag_dev

# Verify pgvector extension
psql postgresql://robrag:robrag_dev_password@localhost:4344/robrag_dev \
  -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'"
```

#### PostgreSQL Prod (from inside container)
```bash
# Connect to production database
docker exec -it postgres-rag-prod psql -U robrag -d robrag_prod
```

### Backups

#### PostgreSQL
```bash
# Backup production
docker exec postgres-rag-prod pg_dump -U robrag robrag_prod > backup-$(date +%Y%m%d).sql

# Backup dev
docker exec postgres-rag-dev pg_dump -U robrag robrag_dev > backup-dev-$(date +%Y%m%d).sql

# Restore
cat backup-20241204.sql | docker exec -i postgres-rag-prod psql -U robrag -d robrag_prod
```

---

## Service Ports

| Service | Port | Access |
|---------|------|--------|
| App | 4345 | External |
| Postgres Dev | 4344 | External (for dev tools) |
| Postgres Prod | - | Internal only |

---

## Database Migrations

Migrations run automatically via Prisma when the app starts.

**Manual migration** (if needed):
```bash
docker compose exec app npx prisma migrate deploy
```

---

## Troubleshooting

### PostgreSQL won't start
```bash
# Check logs
docker compose logs postgres-prod

# Check if port is in use
sudo lsof -i :4344

# Reset (⚠️ DELETES DATA)
docker compose down -v
docker compose up -d
```

### App can't connect to PostgreSQL
```bash
# Verify PostgreSQL is healthy
docker compose ps

# Test connection
docker exec -it postgres-rag-prod psql -U robrag -d robrag_prod -c "SELECT 1"

# Check environment
docker compose exec app env | grep DATABASE_URL
```

### pgvector extension missing
```bash
# Check if enabled
docker exec -it postgres-rag-prod psql -U robrag -d robrag_prod \
  -c "SELECT extname FROM pg_extension WHERE extname = 'vector'"

# Enable if missing
docker exec -it postgres-rag-prod psql -U robrag -d robrag_prod \
  -c "CREATE EXTENSION IF NOT EXISTS vector"
```

---

## Development

### Connect with Database Tools

**pgAdmin** or any PostgreSQL client:
- Host: `localhost`
- Port: `4344`
- Database: `robrag_dev`
- Username: `robrag`
- Password: `robrag_dev_password`

### Local Development
```bash
# Use dev database
export DATABASE_URL="postgresql://robrag:robrag_dev_password@localhost:4344/robrag_dev"

# Run Prisma commands
npx prisma studio     # Database GUI
npx prisma db push    # Push schema changes
npx prisma migrate dev  # Create migration

# Run app locally
npm run dev
```

---

## Volume Management

### List volumes
```bash
docker volume ls | grep rob_rag
```

### Backup volume
```bash
docker run --rm \
  -v rob_rag_postgres-prod-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar -czf /backup/postgres-prod-$(date +%Y%m%d).tar.gz -C /data .
```

### Remove volume (⚠️ DELETES DATA)
```bash
docker compose down -v
```

---

## What Changed

### Removed
- ❌ SQLite (now using PostgreSQL for everything)
- ❌ Qdrant (now using pgvector in PostgreSQL)

### Simplified
- ✅ One database for everything (structured data + vectors)
- ✅ Automatic migrations (Prisma handles it)
- ✅ Simpler architecture (fewer moving parts)
- ✅ Better queries (hybrid metadata + vector search)

---

## Architecture

```
┌─────────────────┐
│   Application   │ (port 4345)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   PostgreSQL    │
│   + pgvector    │
│                 │
│ ├─ Users/Auth   │
│ ├─ Conversations│
│ ├─ Settings     │
│ ├─ Documents    │
│ └─ Vectors      │
└─────────────────┘
```

**Everything in one database!**

---

**Simple and production-ready!** 🚀
