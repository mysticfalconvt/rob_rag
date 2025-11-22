# Server Deployment Guide

## Prerequisites

- Docker and Docker Compose installed on your server
- LM Studio running and accessible from the server

## Storage Structure

All data will be stored under `/mnt/user/appdata/rob_rag/`:

```
/mnt/user/appdata/rob_rag/
├── qdrant/              # Qdrant vector database storage (existing)
└── app/                 # Application data (new)
    ├── prisma/          # SQLite database
    │   └── dev.db
    └── documents/       # Document storage
        ├── File Uploads/    # User uploaded files
        └── Sync Files/      # Synced documents
```

## Initial Setup

1. **Create the directory structure:**

```bash
mkdir -p /mnt/user/appdata/rob_rag/app/prisma
mkdir -p /mnt/user/appdata/rob_rag/app/documents/File\ Uploads
mkdir -p /mnt/user/appdata/rob_rag/app/documents/Sync\ Files
```

2. **Download the compose file:**

```bash
cd /mnt/user/appdata/rob_rag
wget https://raw.githubusercontent.com/mysticfalconvt/rob_rag/main/docker-compose.server.yml
wget https://raw.githubusercontent.com/mysticfalconvt/rob_rag/main/.env.example
```

3. **Configure environment variables:**

```bash
cp .env.example .env
nano .env
```

Update these values:
- `LM_STUDIO_API_URL` - Your LM Studio URL (e.g., `http://10.0.0.20:1234/v1`)
- `LM_STUDIO_API_KEY` - Your LM Studio API key
- `EMBEDDING_MODEL_NAME` - Your embedding model name
- `CHAT_MODEL_NAME` - Your chat model name

4. **Start the services:**

```bash
docker compose -f docker-compose.server.yml up -d
```

## Updating to Latest Version

```bash
cd /mnt/user/appdata/rob_rag
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d
```

## Accessing the Application

- Web Interface: http://your-server-ip:4345
- Qdrant REST API: http://your-server-ip:4344
- Qdrant gRPC API: http://your-server-ip:6334

## Migrating from Existing Qdrant Setup

If you already have Qdrant running with the old docker-compose.yml:

1. **Stop the old Qdrant container:**

```bash
docker stop qdrant-rag
docker rm qdrant-rag
```

2. **Follow the Initial Setup steps above**

Your Qdrant data is preserved at `/mnt/user/appdata/rob_rag/qdrant/` and will be used by the new setup.

## Logs and Troubleshooting

**View logs:**
```bash
docker compose -f docker-compose.server.yml logs -f app
docker compose -f docker-compose.server.yml logs -f qdrant
```

**Restart services:**
```bash
docker compose -f docker-compose.server.yml restart
```

**Stop services:**
```bash
docker compose -f docker-compose.server.yml down
```

## Backup

To backup your data, copy these directories:
- `/mnt/user/appdata/rob_rag/app/prisma/` - Database
- `/mnt/user/appdata/rob_rag/app/documents/` - Documents
- `/mnt/user/appdata/rob_rag/qdrant/` - Vector database
