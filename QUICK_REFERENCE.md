# Quick Reference Guide

**One-page cheat sheet for RobRAG Docker operations**

---

## 🚀 Start Services

```bash
# Production
docker compose --profile prod up -d

# Development
docker compose --profile dev up -d

# With pgAdmin
docker compose --profile prod --profile dev-tools up -d
```

---

## 🛑 Stop Services

```bash
# Stop (keeps data)
docker compose --profile prod down

# Stop and remove volumes (⚠️ DELETES DATA)
docker compose --profile prod down -v
```

---

## 📊 Monitor

```bash
# View all logs
docker compose --profile prod logs -f

# View app logs only
docker compose --profile prod logs -f app

# Check status
docker compose --profile prod ps

# Resource usage
docker stats
```

---

## 🗄️ Database Access

### PostgreSQL

```bash
# Connect to dev Postgres (from host)
psql postgresql://robrag:robrag_dev_password@localhost:5433/robrag_dev

# Connect to prod Postgres (from container)
docker exec -it postgres-rag-prod psql -U robrag -d robrag_prod

# Run Prisma migrations
docker exec -it rob_rag_app npx prisma migrate deploy
```

### Qdrant

```bash
# Check collections
curl http://localhost:4344/collections

# View collection info
curl http://localhost:4344/collections/documents
```

---

## 💾 Backup

### PostgreSQL Backup
```bash
# Backup production database
docker exec postgres-rag-prod pg_dump -U robrag robrag_prod > backup-$(date +%Y%m%d).sql

# Restore production database
cat backup-20241204.sql | docker exec -i postgres-rag-prod psql -U robrag -d robrag_prod
```

### Qdrant Backup
```bash
# Backup production Qdrant
docker exec qdrant-rag-prod tar -czf /tmp/qdrant-backup.tar.gz /qdrant/storage
docker cp qdrant-rag-prod:/tmp/qdrant-backup.tar.gz ./backups/qdrant-$(date +%Y%m%d).tar.gz

# Restore production Qdrant
docker cp ./backups/qdrant-20241204.tar.gz qdrant-rag-prod:/tmp/
docker exec qdrant-rag-prod tar -xzf /tmp/qdrant-backup.tar.gz -C /
docker compose --profile prod restart qdrant-prod
```

---

## 🔧 Troubleshooting

### App won't start
```bash
# Check logs
docker compose --profile prod logs app

# Check database health
docker compose --profile prod ps postgres-prod

# Restart app
docker compose --profile prod restart app
```

### Database connection issues
```bash
# Verify environment variables
docker compose --profile prod exec app env | grep DATABASE_URL

# Test Postgres connection
docker exec postgres-rag-prod pg_isready -U robrag

# Check network
docker network inspect rob_rag_rag-network
```

### Port already in use
```bash
# Find process using port 4345
sudo lsof -i :4345

# Kill process
sudo kill -9 <PID>
```

---

## 🧪 Testing

```bash
# Test dev environment
docker compose --profile dev up -d
curl http://localhost:3000/api/health

# Test production environment
docker compose --profile prod up -d
curl http://localhost:4345/api/health

# Check Postgres connection
docker exec -it postgres-rag-dev psql -U robrag -d robrag_dev -c "SELECT version();"
```

---

## 🔄 Updates

```bash
# Pull latest images
docker compose --profile prod pull

# Restart with new image
docker compose --profile prod up -d

# Rebuild from source (dev)
docker compose --profile dev up -d --build app-dev
```

---

## 📁 Files Reference

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Unified Docker configuration |
| `DOCKER_SETUP.md` | Complete Docker guide |
| `POSTGRES_MIGRATION_PLAN.md` | Migration technical plan |
| `MIGRATION_SUMMARY.md` | Overview of changes |
| `.env` | Environment variables |

---

## 🔑 Default Credentials

### Development
- **Postgres**: `robrag` / `robrag_dev_password`
- **Database**: `robrag_dev`
- **Port**: `5433`

### Production
- **Postgres**: `robrag` / Set in `.env`
- **Database**: `robrag_prod`
- **Port**: Internal only

### pgAdmin
- **Email**: `admin@example.com`
- **Password**: `admin`
- **Port**: `5050`

---

## 🌐 Service Ports

| Service | Profile | Port | Access |
|---------|---------|------|--------|
| App (prod) | `prod` | 4345 | External |
| App (dev) | `dev` | 3000 | External |
| Postgres Dev | `dev`/`prod` | 5433 | External |
| Postgres Prod | `prod` | - | Internal |
| Qdrant Dev | `dev`/`prod` | 4344 | External |
| Qdrant Prod | `prod` | - | Internal |
| pgAdmin | `dev-tools` | 5050 | External |

---

## 🎯 Common Tasks

### Fresh Start
```bash
# Clean everything (⚠️ DELETES DATA)
docker compose --profile prod down -v
docker compose --profile prod up -d
```

### Reset Dev Environment
```bash
# Reset dev database only
docker compose --profile dev stop app-dev postgres-dev
docker volume rm rob_rag_postgres-dev-data
docker compose --profile dev up -d
```

### View Database Size
```bash
# Postgres
docker exec postgres-rag-prod psql -U robrag -d robrag_prod -c "SELECT pg_size_pretty(pg_database_size('robrag_prod'));"

# Qdrant
docker exec qdrant-rag-prod du -sh /qdrant/storage
```

---

## 🚨 Emergency Procedures

### Rollback to Qdrant
```bash
# Set feature flag to use Qdrant
docker compose --profile prod exec app sh -c "echo 'USE_POSTGRES_VECTORS=false' >> /app/.env"
docker compose --profile prod restart app
```

### Restore from Backup
```bash
# Stop services
docker compose --profile prod down

# Restore Postgres
cat backup-20241204.sql | docker exec -i postgres-rag-prod psql -U robrag -d robrag_prod

# Restore Qdrant
docker cp ./backups/qdrant-20241204.tar.gz qdrant-rag-prod:/tmp/
docker exec qdrant-rag-prod tar -xzf /tmp/qdrant-backup.tar.gz -C /

# Restart
docker compose --profile prod up -d
```

---

## 📞 Need Help?

1. Check `DOCKER_SETUP.md` for detailed troubleshooting
2. Review `POSTGRES_MIGRATION_PLAN.md` for migration issues
3. Check logs: `docker compose --profile prod logs -f`

---

**Last Updated**: 2024-12-04
