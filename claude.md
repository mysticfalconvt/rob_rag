# RobRAG - AI Assistant Context

## Project Overview
Next.js 16 RAG application with document indexing, semantic search, and LLM-powered chat. Uses PostgreSQL with pgvector for embeddings and metadata storage.

## Tech Stack
- **Framework**: Next.js 16 (App Router), TypeScript, React 19
- **Database**: PostgreSQL 16 with pgvector extension
- **ORM**: Prisma (migrations in `prisma/migrations/`)
- **Package Manager**: pnpm (required)
- **LLM**: LM Studio (local API on port 1234)
- **Embeddings**: Configurable via LM Studio API
- **Document Processing**: pdf-parse, mammoth, pdf2pic with GraphicsMagick/Ghostscript for OCR
- **Auth**: iron-session with bcrypt
- **Container**: Docker Compose for production

## Development Setup

### Prerequisites
- Node.js 18+, pnpm
- Docker & Docker Compose
- LM Studio running locally with embedding and chat models loaded

### Start Dev Environment
```bash
# Start databases (both dev and prod containers)
docker-compose up -d

# Install dependencies
pnpm install

# Run migrations (dev DB connection via .env)
pnpm prisma migrate dev

# Start development server
pnpm dev
```

**Dev Mode**: Runs `pnpm dev` locally, connects to `postgres-dev` container (exposed on port 4344) via DATABASE_URL in `.env`.

## Production Deployment

### Docker Compose Stack
- **app**: Next.js application (port 4345 → 3000)
- **postgres-prod**: PostgreSQL with pgvector (internal network only)
- **postgres-dev**: Development database (exposed on 4344)

### Automatic Migrations
The `docker-entrypoint.sh` script handles migrations automatically on container startup:
1. Syncs schema/migrations from image to mounted volume
2. Backs up database (keeps last 5 backups)
3. Runs `prisma migrate deploy` to apply pending migrations
4. Validates schema for drift
5. Starts the application

**IMPORTANT**: After pulling a new image with schema changes, simply restart the container. Migrations run automatically before the app starts.

```bash
docker-compose pull
docker-compose up -d
```

### Environment Variables
See `.env.example` for all options. Key variables:
- `DATABASE_URL`: PostgreSQL connection string
- `USE_POSTGRES_VECTORS=true`: Uses pgvector (no Qdrant)
- `LM_STUDIO_API_URL`: LM Studio endpoint
- `EMBEDDING_MODEL_NAME`, `CHAT_MODEL_NAME`: Model names
- `DOCUMENTS_FOLDER_PATH`: Document storage path
- `SESSION_SECRET`: Generate with `openssl rand -base64 32`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`: Initial admin user (auto-created)

### Volume Mounts
Production mounts:
- `/mnt/user/appdata/rob_rag/app/documents` → `/app/documents`
- `/mnt/user/MiscStorage/sync/Sync/Obsidian/Robs Info` → `/app/documents/Sync Files/obsidian`
- `/mnt/user/appdata/rob_rag/pgProd` → PostgreSQL data

## Key Features

### Authentication
- Session-based auth with iron-session
- Role-based access (admin/user)
- CSRF protection
- Admin can manage users via `/api/auth/users`

### Document Sources
- **Local Files**: Watches `DOCUMENTS_FOLDER_PATH` with chokidar, supports PDF/DOCX/MD/TXT
- **Paperless-ngx**: Integrates via API (configure in `/config`)
- **Goodreads**: Import library via CSV, sync via RSS feeds (configure in `/config`)
- **Google Calendar**: Sync events via OAuth (configure in `/config`)
- **File Uploads**: Authenticated users can upload documents

### Data Source Syncing
All external data sources (Google Calendar, Paperless, Goodreads) are synced via a **unified daily sync** mechanism:
- **Single sync time**: Configure daily sync time in `/status` page under "Data Source Sync" card
- **Manual trigger**: Use "Sync Now" button in `/status` page
- **Automated**: Runs once daily at configured time via background scheduler
- **Implementation**: All sync logic in `lib/syncAll.ts`

**IMPORTANT**: When adding new data sources:
1. Add sync logic to `syncAllDataSources()` function in `lib/syncAll.ts`
2. DO NOT create separate sync mechanisms, UI controls, or webhook endpoints
3. DO NOT add per-source scheduling - use the unified daily sync
4. This prevents drift and maintains a single source of truth for syncing

### Custom OCR
- Vision model-based OCR for scanned PDFs
- Uses pdf2pic with GraphicsMagick and Ghostscript
- Stores originals in `Custom_Docs/originals`, markdown output in `Custom_Docs/markdown`
- Tracks OCR status in `IndexedFile.useCustomOcr` field

### Tag System
- Global tag management with approval workflow
- Auto-generate tags using LLM vision analysis
- Tags stored in `Tag`, `DocumentTag` junction table

### Context Management
- Configurable context strategies: smart/fixed/sliding_window
- Conversation summarization for long chats
- Iterative retrieval with query refinement
- Source-specific filtering (files/paperless/goodreads)

## Database Schema Notes

### Key Models
- **AuthUser**: Users with sessions
- **IndexedFile**: Document metadata, includes paperless and OCR fields
- **DocumentChunk**: Embedded chunks with pgvector support
- **Conversation/Message**: Chat history
- **Settings**: Singleton config (models, prompts, context settings)
- **GoodreadsUser/Book**: Reading history with embeddings
- **LLMRequest/LLMCall**: Token usage tracking
- **Tag/DocumentTag**: Global tagging system

### Migrations
Current schema version: `20251214184054_add_global_tag_system`

Always use `prisma migrate dev` for local changes, never `db push` in production.

## Important Scripts
```bash
pnpm dev          # Dev server (hot reload)
pnpm build        # Production build
pnpm start        # Production server
pnpm lint         # Biome linter
pnpm format       # Biome formatter
```

## API Highlights
- `/api/chat`: RAG-powered chat with streaming
- `/api/chat-direct`: Direct LLM (no retrieval)
- `/api/reindex/source`: Reindex specific source (files/paperless/goodreads)
- `/api/ocr/process`: Trigger custom OCR
- `/api/tags`: Tag management
- `/api/documents/[id]/generate-tags`: LLM-based tag generation
- `/api/admin/llm-metrics`: Token usage analytics
- `/api/health`: Health check (used by Docker healthcheck)

## Code Organization
- `app/`: Next.js App Router pages and API routes
- `lib/`: Core business logic (indexer, retrieval, auth, plugins)
- `lib/plugins/`: Data source plugins (files, paperless, goodreads)
- `prisma/`: Schema and migrations

## Common Tasks

### Add a Migration
```bash
pnpm prisma migrate dev --name description_here
# Commit both schema.prisma and migration SQL files
```

### Reindex Documents
Via API or UI at `/status`:
- All sources: POST `/api/reindex`
- Specific: POST `/api/reindex/source` with `{"source": "files|paperless|goodreads"}`

### Add New Document Type
1. Update `lib/files.ts` for extraction logic
2. Add file type handling in `lib/indexer.ts`
3. Update API routes if needed

### Configure LLM Models
UI at `/settings` or database Settings table. Changes take effect immediately.

## Troubleshooting

- **Migrations fail**: Check `docker-entrypoint.sh` output, backups in `/app/prisma/dev.db.backup.*`
- **Connection refused**: Verify postgres-prod container is healthy, check DATABASE_URL
- **OCR not working**: Ensure GraphicsMagick and Ghostscript installed (in Dockerfile)
- **Embeddings mismatch**: Check `embeddingModelDimension` in Settings matches actual model dimension

## Notes
- PostgreSQL vector extension enabled by default (`USE_POSTGRES_VECTORS=true`)
- Qdrant support removed in favor of pgvector
- Custom OCR requires vision model in LM Studio (`visionModel` in Settings)
- Tag status must be "approved" to appear in UI filters
