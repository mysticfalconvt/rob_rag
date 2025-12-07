# Quick Start Guide

**Get RobRAG running in 3 steps!**

---

## Step 1: Configure

```bash
cp .env.example .env
nano .env
```

**Required settings:**
```bash
POSTGRES_PASSWORD=your_secure_password_here
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=secure_admin_password
SESSION_SECRET=$(openssl rand -base64 32)
LM_STUDIO_API_URL=http://your-lm-studio:1234/v1
```

---

## Step 2: Deploy

```bash
docker compose up -d
```

Wait ~30 seconds for PostgreSQL to initialize.

---

## Step 3: Access

Open: **http://localhost:4345**

Login with your `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

---

## That's It! 🎉

**Check logs:**
```bash
docker compose logs -f app
```

**Restart:**
```bash
docker compose restart app
```

**Stop:**
```bash
docker compose down
```

---

## Ports

- **4345** - RobRAG app
- **4344** - PostgreSQL dev (for pgAdmin, psql, etc.)

---

## Connect to Dev Database

```bash
psql postgresql://robrag:robrag_dev_password@localhost:4344/robrag_dev
```

---

## Need Help?

Read the full guides:
- **SETUP.md** - Complete setup instructions
- **DOCKER_SETUP.md** - Docker commands
- **FINAL_SUMMARY.md** - Architecture overview

---

**Simple. Clean. Production-ready.** ✨
