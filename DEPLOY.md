# Deploy Fixed Code to Server

The corruption issue is caused by arrays in Qdrant payloads. The fix is in your local code, but the server is running an old Docker image from GHCR.

## Step 1: Build and push new image

```bash
cd /home/rboskind/code/rob_rag

# Build new image with your fixes
docker build -t ghcr.io/mysticfalconvt/rob_rag:latest .

# Push to registry (requires authentication)
docker push ghcr.io/mysticfalconvt/rob_rag:latest
```

## Step 2: Deploy on Unraid server

SSH to your Unraid server and run:

```bash
# Pull new image
docker pull ghcr.io/mysticfalconvt/rob_rag:latest

# Stop and remove old containers
docker compose -f /path/to/docker-compose.server.yml down

# Remove corrupted Qdrant data
rm -rf /mnt/cache/appdata/rob_rag/qdrant/*

# Start with new image
docker compose -f /path/to/docker-compose.server.yml up -d

# Check logs
docker logs -f rob_rag_app
```

## Step 3: Re-index

Once containers are running, re-index your data via the web UI at http://your-server:4345

## Alternative: Local build without registry

If you can't push to GHCR, modify docker-compose.server.yml to build locally:

```yaml
services:
  app:
    build: .  # Add this
    # image: ghcr.io/mysticfalconvt/rob_rag:latest  # Comment this out
    container_name: rob_rag_app
    ...
```

Then on Unraid:
```bash
cd /path/to/rob_rag
docker compose -f docker-compose.server.yml build
docker compose -f docker-compose.server.yml up -d
```
