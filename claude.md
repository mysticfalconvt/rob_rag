# RobRAG - AI Assistant Context

## Project Overview
Next.js 16 RAG application with multi-source document indexing, intelligent retrieval, tool-based agents, and LLM-powered chat. Uses PostgreSQL with pgvector for embeddings and metadata storage. Includes a Matrix chat bot, email integration, web search, and background scheduling.

## Tech Stack
- **Framework**: Next.js 16 (App Router), TypeScript, React 19
- **Database**: PostgreSQL 16 with pgvector extension
- **ORM**: Prisma (migrations in `prisma/migrations/`)
- **Package Manager**: pnpm (required)
- **LLM**: LM Studio (local API on port 1234)
- **Embeddings**: Configurable via LM Studio API (default: nomic-embed-text, 1024 dims)
- **Chat Orchestration**: LangChain (`@langchain/core`, `@langchain/openai`, `@langchain/textsplitters`)
- **Document Processing**: pdf-parse, mammoth, pdf2pic with GraphicsMagick/Ghostscript for OCR
- **Auth**: iron-session with bcrypt
- **Matrix**: matrix-js-sdk for chat bot integration
- **Email**: imapflow + mailparser (Zoho IMAP), googleapis (Gmail OAuth)
- **Web Search**: SearXNG and Perplexica integrations
- **Validation**: zod
- **Linting**: Biome
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
- `FAST_CHAT_MODEL_NAME`: Optional separate model for auxiliary tasks (query routing, summarization)
- `DOCUMENTS_FOLDER_PATH`: Document storage path
- `SESSION_SECRET`: Generate with `openssl rand -base64 32`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`: Initial admin user (auto-created)
- `WEBHOOK_SECRET`, `INTERNAL_SERVICE_KEY`: Auth for webhooks and internal services (Matrix, scheduler)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google OAuth for Calendar and Gmail
- `SEARXNG_URL`, `PERPLEXICA_URL`: Web search backends
- `USER_TIMEZONE`: Timezone for scheduling (e.g., `America/New_York`)

### Volume Mounts
Production mounts:
- `/mnt/user/appdata/rob_rag/app/documents` → `/app/documents`
- `/mnt/user/MiscStorage/sync/Sync/Obsidian/Robs Info` → `/app/documents/Sync Files/obsidian`
- `/mnt/user/appdata/rob_rag/pgProd` → PostgreSQL data

## Architecture

### Plugin System
Data sources are implemented as plugins in `lib/plugins/`:
- `filesPlugin.ts` — Local file source
- `goodreadsPlugin.ts` — Goodreads books
- `paperlessPlugin.ts` — Paperless-ngx documents
- `calendarPlugin.ts` — Google Calendar events
- `emailPlugin.ts` — Gmail/Zoho email

All plugins implement the `DataSourcePlugin` interface and register in `lib/plugins/index.ts`. The registry (`lib/dataSourceRegistry.ts`) provides plugin discovery and capability queries.

### Tool System
The LLM uses function calling to invoke tools during conversation:
- `lib/toolGenerator.ts` — Dynamically creates LangChain tools from plugins
- `lib/toolRouter.ts` — Analyzes query intent and filters tools to reduce LLM confusion
- `lib/tools/ragTool.ts` — Knowledge base search tool
- `lib/tools/reminderTool.ts` — Reminder creation/management
- `lib/tools/noteTool.ts` — Note taking
- `lib/tools/webSearchTool.ts` — SearXNG/Perplexica web search
- `lib/utilityTools.ts` — Utility tools (reminders, notes)

### RAG Pipeline
1. **Ingestion**: File scanning → content extraction → chunking (800 tokens, 200 overlap) → embedding → pgvector storage
2. **Query Processing**: Query analysis → smart routing (fast/slow path) → vector search with source filtering → iterative refinement → tag-based score boosting
3. **Generation**: Context building → token budget management → system prompt selection → LLM streaming → tool execution → metrics tracking

Key retrieval files:
- `lib/retrieval.ts` — Core vector search with pgvector
- `lib/smartRetrieval.ts` — Query classification and strategy selection
- `lib/queryRouter.ts` — Fast vs slow path routing
- `lib/iterativeRetrieval.ts` — Multi-pass refinement
- `lib/contextBuilder.ts` — User context and query enrichment
- `lib/contextWindow.ts` — Token budget management (smart/fixed/sliding_window strategies)
- `lib/sourceAnalysis.ts` — Determine relevant data sources
- `lib/queryBuilder.ts` — Search query construction

### Matrix Bot
- `lib/matrix/client.ts` — Matrix SDK wrapper and connection management
- `lib/matrix/sender.ts` — Message formatting and sending
- `lib/matrix/messageHandler.ts` — Incoming message processing through RAG pipeline
- Configuration via `/api/matrix/config` and `/api/matrix/rooms`
- Supports per-room RAG toggle, allowed users list, scheduled reminders via cron

### Email Integration
- `lib/email/gmailProvider.ts` — Gmail OAuth & API
- `lib/email/zohoProvider.ts` — Zoho IMAP client
- `lib/email/types.ts` — Shared interfaces
- Supports search, read, archive, delete operations with permission controls

### Background Scheduling
- `lib/scheduler.ts` — Cron-based task scheduler
- `lib/syncAll.ts` — Unified data source sync orchestration
- Handles daily syncs, Matrix reminders, and general scheduled tasks
- Execution history tracked in database

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
- **Email**: Gmail (OAuth) and Zoho (IMAP) accounts (configure in `/config`)
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
- Matching tags boost search relevance scores (+10% per tag, max 30%)

### Context Management
- Configurable context strategies: smart/fixed/sliding_window
- Token budget: `maxContextTokens` (default 8000)
- Conversation summarization for long chats
- Iterative retrieval with query refinement
- Source-specific filtering (files/paperless/goodreads/calendar/email)
- Follow-up question rephrasing for self-contained queries

### Web Search
- SearXNG integration (`SEARXNG_URL`)
- Perplexica integration (`PERPLEXICA_URL`)
- Available as a tool the LLM can invoke during conversation

### LLM Analytics
- Token usage tracking (prompt + completion) per request
- Latency measurements
- Error tracking
- Stored in `LLMRequest` and `LLMCall` tables
- Dashboard at `/admin`

## Database Schema Notes

### Key Models
- **AuthUser**: Users with sessions and profiles (name, bio, preferences)
- **IndexedFile**: Document metadata, includes paperless, OCR, and source fields
- **DocumentChunk**: Embedded chunks with pgvector support
- **Conversation/Message**: Chat history with topics and metadata
- **Settings**: Singleton config (models, prompts, context settings, sync times)
- **GoodreadsUser/Book**: Reading history with embeddings
- **LLMRequest/LLMCall**: Token usage and latency tracking
- **Tag/DocumentTag**: Global tagging system
- **MatrixConfig/MatrixRoom**: Matrix bot configuration and room management
- **ScheduledTask**: Cron-based scheduled tasks and reminders
- **EmailAccount**: Email provider configuration (Gmail/Zoho)
- **SyncSettings**: Unified sync configuration and status tracking

### Migrations
Current latest migration: `20260221174040_add_email_account`

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

### Core
- `/api/chat`: RAG-powered chat with streaming and tool execution
- `/api/chat-direct`: Direct LLM (no retrieval)
- `/api/health`: Health check (used by Docker healthcheck)
- `/api/status`: System status and statistics

### Documents & Indexing
- `/api/files`: File browsing and contents
- `/api/upload`: Document upload
- `/api/scan`: Source scanning
- `/api/reindex/source`: Reindex specific source (files/paperless/goodreads/calendar/email)
- `/api/ocr/process`: Trigger custom OCR

### Tags & Documents
- `/api/tags`: Tag CRUD
- `/api/documents/[id]/generate-tags`: LLM-based tag generation

### Integrations
- `/api/goodreads/*`: Goodreads user management and sync
- `/api/google/auth`: Google OAuth flow
- `/api/matrix/config`: Matrix bot config
- `/api/matrix/rooms`: Matrix room management
- `/api/matrix/send`: Send Matrix message
- `/api/email/accounts`: Email account management
- `/api/email/search`: Email search
- `/api/web-search`: Web search proxy
- `/api/webhooks/sync-all`: Webhook sync trigger

### Admin
- `/api/auth/users`: User management
- `/api/admin/llm-metrics`: Token usage analytics
- `/api/settings`: Global settings
- `/api/models`: LLM model management
- `/api/scheduler`: Background job management
- `/api/scheduled`: Scheduled task management

## Code Organization
- `app/`: Next.js App Router pages and API routes
- `app/api/`: REST API endpoints
- `lib/`: Core business logic
- `lib/plugins/`: Data source plugins (files, paperless, goodreads, calendar, email)
- `lib/tools/`: LangChain tool implementations (RAG, reminders, notes, web search)
- `lib/matrix/`: Matrix bot client, sender, and message handler
- `lib/email/`: Email providers (Gmail, Zoho)
- `components/`: React UI components (40+)
- `hooks/`: React hooks
- `types/`: TypeScript definitions
- `prisma/`: Schema and migrations
- `docker/`: Docker configuration and init scripts
- `scripts/`: Utility scripts

## Common Tasks

### Add a Migration
```bash
pnpm prisma migrate dev --name description_here
# Commit both schema.prisma and migration SQL files
```

### Reindex Documents
Via API or UI at `/status`:
- All sources: POST `/api/reindex`
- Specific: POST `/api/reindex/source` with `{"source": "files|paperless|goodreads|calendar|email"}`

### Add a New Data Source
1. Create a plugin in `lib/plugins/` implementing `DataSourcePlugin`
2. Register in `lib/plugins/index.ts`
3. Add sync logic to `syncAllDataSources()` in `lib/syncAll.ts`
4. Add source type to relevant API routes and UI filters
5. DO NOT create separate sync mechanisms — use the unified daily sync

### Add a New Tool
1. Create tool in `lib/tools/` using LangChain tool interface
2. Register in `lib/toolGenerator.ts` or `lib/utilityTools.ts`
3. Add routing hints in `lib/toolRouter.ts` if needed

### Configure LLM Models
UI at `/settings` or database Settings table. Changes take effect immediately.

## Troubleshooting

- **Migrations fail**: Check `docker-entrypoint.sh` output, backups in `/app/prisma/dev.db.backup.*`
- **Connection refused**: Verify postgres-prod container is healthy, check DATABASE_URL
- **OCR not working**: Ensure GraphicsMagick and Ghostscript installed (in Dockerfile)
- **Embeddings mismatch**: Check `embeddingModelDimension` in Settings matches actual model dimension
- **Matrix bot not responding**: Check INTERNAL_SERVICE_KEY matches, verify allowed users list
- **Email auth failure**: Gmail requires OAuth re-auth periodically; Zoho needs IMAP app password

## Notes
- PostgreSQL vector extension enabled by default (`USE_POSTGRES_VECTORS=true`)
- Qdrant support removed in favor of pgvector
- Custom OCR requires vision model in LM Studio (`visionModel` in Settings)
- Tag status must be "approved" to appear in UI filters
- `FAST_CHAT_MODEL_NAME` can be set for faster auxiliary tasks (routing, summarization) separate from the main chat model
- The tool router filters available tools per query to reduce LLM confusion — not all tools are presented on every request
