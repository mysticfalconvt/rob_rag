# RobRAG Setup Guide

Quick setup guide for RobRAG with PostgreSQL + pgvector.

---

## Prerequisites

- Docker & Docker Compose
- LM Studio or compatible OpenAI API endpoint
- `.env` file with your configuration

---

## Quick Setup

### 1. Configure Environment

Copy the example and customize:

```bash
cp .env.example .env
```

Edit `.env` and set:
- `POSTGRES_PASSWORD` - Secure password for production
- `LM_STUDIO_API_URL` - Your LM Studio endpoint
- `SESSION_SECRET` - Generate with `openssl rand -base64 32`
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` - Initial admin credentials

### 2. Start Services

```bash
docker compose up -d
```

This starts:
- PostgreSQL with pgvector (production + dev)
- Your RobRAG application

### 3. Initialize Database

The database schema is automatically created on first startup via Prisma migrations.

**If migrations don't run automatically**, run manually:

```bash
docker compose exec app npx prisma migrate deploy
```

### 4. Access Application

- **App**: http://localhost:4345
- **PostgreSQL Dev**: `localhost:4344` (for local tools like pgAdmin)

---

## Database Migrations

### Automatic (Recommended)

Migrations run automatically when you deploy new versions via Docker.

### Manual

If you need to run migrations manually:

```bash
# Deploy pending migrations
docker compose exec app npx prisma migrate deploy

# View migration status
docker compose exec app npx prisma migrate status
```

### Creating New Migrations

When you update the Prisma schema:

```bash
# On your local machine (not in Docker)
export DATABASE_URL="postgresql://robrag:robrag_dev_password@localhost:5433/robrag_dev"

# Create migration
npx prisma migrate dev --name your_migration_name

# Commit the migration files
git add prisma/migrations/
git commit -m "Add migration: your_migration_name"
```

Next deployment will automatically apply it.

---

## First-Time Setup

On first startup:

1. PostgreSQL initializes with pgvector extension
2. Prisma creates all tables
3. App creates default admin user (from .env)
4. You can log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`

---

## Upgrading

To upgrade to a new version:

```bash
# Pull latest image
docker compose pull

# Restart (migrations run automatically)
docker compose up -d

# View logs to verify
docker compose logs -f app
```

**That's it!** Migrations are handled automatically.

---

## Backup & Restore

### Backup

```bash
# Backup PostgreSQL
docker exec postgres-rag-prod pg_dump -U robrag robrag_prod > backup-$(date +%Y%m%d).sql

# Backup documents
tar -czf documents-backup-$(date +%Y%m%d).tar.gz /mnt/user/appdata/rob_rag/app/documents
```

### Restore

```bash
# Restore PostgreSQL
cat backup-20241204.sql | docker exec -i postgres-rag-prod psql -U robrag -d robrag_prod

# Restore documents
tar -xzf documents-backup-20241204.tar.gz -C /
```

---

## Troubleshooting

### App won't start

```bash
# Check logs
docker compose logs app

# Common issues:
# - PostgreSQL not ready: Wait 30 seconds and check again
# - Missing .env: Copy from .env.example
# - Migration failed: Check database logs
```

### PostgreSQL connection errors

```bash
# Verify PostgreSQL is healthy
docker compose ps postgres-prod

# Check if it's ready
docker exec postgres-rag-prod pg_isready -U robrag

# View logs
docker compose logs postgres-prod
```

### Reset everything (⚠️ DELETES ALL DATA)

```bash
docker compose down -v
docker compose up -d
```

---

## Development

### Local Development with Dev Database

```bash
# Use dev database (port 4344)
export DATABASE_URL="postgresql://robrag:robrag_dev_password@localhost:4344/robrag_dev"

# Run Prisma commands
npx prisma studio  # Database GUI
npx prisma db push  # Push schema changes
npx prisma migrate dev  # Create migration

# Run app locally
npm run dev
```

### Connecting with Database Tools

**pgAdmin** or any PostgreSQL client:
- Host: `localhost`
- Port: `4344`
- Database: `robrag_dev`
- Username: `robrag`
- Password: `robrag_dev_password`

---

## Configuration Reference

### Required Environment Variables

```bash
# Database
POSTGRES_PASSWORD=your_secure_password  # REQUIRED
DATABASE_URL=postgresql://...  # Auto-generated from POSTGRES_* vars

# Application
SESSION_SECRET=generated_secret  # REQUIRED (use openssl rand -base64 32)
ADMIN_EMAIL=admin@example.com  # REQUIRED
ADMIN_PASSWORD=secure_password  # REQUIRED

# LM Studio
LM_STUDIO_API_URL=http://your-lm-studio:1234/v1  # REQUIRED
```

### Optional Environment Variables

```bash
# Models
EMBEDDING_MODEL_NAME=nomic-embed-text  # Default
CHAT_MODEL_NAME=llama-3.2-1b-instruct  # Default

# App
APP_NAME=RobRAG  # Default
ADMIN_NAME=Administrator  # Default

# Dev Database (only for local development)
DEV_POSTGRES_USER=robrag
DEV_POSTGRES_PASSWORD=robrag_dev_password
DEV_POSTGRES_DB=robrag_dev
```

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
│ ├─ Documents    │
│ └─ Vectors      │
└─────────────────┘
```

**Everything in one database** - no SQLite, no separate vector DB.

---

## Need Help?

- **Logs**: `docker compose logs -f`
- **Status**: `docker compose ps`
- **Shell**: `docker compose exec app sh`
- **Database**: `docker exec -it postgres-rag-prod psql -U robrag -d robrag_prod`

---

**Simple, clean, production-ready!** 🚀
