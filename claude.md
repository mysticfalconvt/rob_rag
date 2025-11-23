# Claude Development Notes

## Project Overview
**RobRAG** - A RAG (Retrieval-Augmented Generation) application built with Next.js that enables document-based question answering with Goodreads and Paperless-ngx integration.

## Package Manager
**Use `pnpm`** - This project uses pnpm, not npm or yarn.

Common commands:
```bash
pnpm install              # Install dependencies
pnpm dev                  # Start development server
pnpm build                # Build for production
pnpm start                # Start production server
pnpm lint                 # Run Biome linter
pnpm format               # Format code with Biome
```

## Tech Stack
- **Framework**: Next.js 16 (App Router) + TypeScript + React 19
- **Database**: SQLite + Prisma ORM
- **Vector DB**: Qdrant (Docker)
- **LLM**: LM Studio (local API, default port 1234)
- **Linting/Formatting**: Biome (not ESLint/Prettier)
- **Styling**: CSS Modules

## Project Structure
```
/app              - Next.js app router pages
  /api            - API routes
  /config         - Configuration page
  /files          - File management
  /status         - Status dashboard
/components       - React components
/lib              - Utility libraries
  /ai.ts          - LLM/embedding functions
  /retrieval.ts   - Vector search logic
  /goodreads.ts   - Goodreads integration
  /prompts.ts     - Prompt management
/prisma           - Database schema
/hooks            - React hooks
/documents        - Default document folder (configurable)
```

## Key Features

### Source Filtering
Documents are tagged with sources:
- `uploaded` - Manually uploaded files
- `synced` - Files from watched folders
- `paperless` - Paperless-ngx documents
- `goodreads:userId` - Goodreads books per user (supports multiple users)

Filters can be combined (OR logic) for multi-source queries.

### Goodreads Integration
- Users can import CSV exports and sync via RSS feeds
- Books are indexed into vector DB with metadata (ratings, read dates, shelves, reviews)
- Supports multiple users with per-user filtering
- Tracks multiple read dates and read counts
- Query examples: "What 5-star sci-fi books did I read in 2024?"

### Paperless-ngx Integration
- Connect to Paperless instance via URL + API token
- Automatically indexes documents with tags and metadata
- Search across both local files and Paperless archive

## Environment Variables
See `.env.example` for template. Key variables:
- `DATABASE_URL` - SQLite database path
- `LM_STUDIO_API_URL` - LM Studio endpoint (default: http://localhost:1234/v1)
- `QDRANT_URL` - Qdrant vector DB URL (default: http://localhost:6333)
- `DOCUMENTS_FOLDER_PATH` - Watched folder path
- `EMBEDDING_MODEL_NAME` - Embedding model in LM Studio
- `CHAT_MODEL_NAME` - Chat model in LM Studio
- `APP_NAME` - Application name (default: RobRAG)

## Database
**Prisma ORM with SQLite**

Commands:
```bash
pnpm prisma migrate dev    # Create and apply migrations
pnpm prisma studio         # Open database GUI
pnpm prisma generate       # Regenerate Prisma client
```

Schema location: `prisma/schema.prisma`

Key models:
- `IndexedFile` - File metadata and indexing status
- `Conversation` + `Message` - Chat history
- `Settings` - App configuration (singleton)
- `User` + `GoodreadsSource` + `GoodreadsBook` - Goodreads data

## Docker
Qdrant runs in Docker via docker-compose:
```bash
docker-compose up -d       # Start Qdrant
docker-compose down        # Stop Qdrant
```

Multiple compose files available:
- `docker-compose.yml` - Local development
- `docker-compose.prod.yml` - Production
- `docker-compose.server.yml` - Server deployment

## Development Tips

### File Watching
The app automatically watches `DOCUMENTS_FOLDER_PATH` for changes using chokidar. New/modified files are automatically re-indexed.

### Vector Search
Search logic in `lib/retrieval.ts`:
- Filters support `source` matching
- Goodreads filters use compound conditions: `source=goodreads AND userId=<id>`
- Format: `goodreads:userId` (e.g., `goodreads:123-456`)

### Context Management
- Customizable prompts in Settings
- User profile context injected into system prompt
- Context window management prevents token overflow
- Strategies: sliding, token-based, or smart

### Testing Locally
1. Start Qdrant: `docker-compose up -d`
2. Start LM Studio (load embedding + chat models)
3. Run migrations: `pnpm prisma migrate dev`
4. Start dev server: `pnpm dev`
5. Add documents to `./documents` folder
6. Visit http://localhost:3000

## Common Tasks

### Add New Document Source
1. Add source type to `IndexedFile.source` in schema
2. Update source filter types in components
3. Add indexing logic to scan API
4. Update filter UI in SourceFilterBar/SettingsDialog

### Change Models
1. Update models in LM Studio
2. Go to `/config` page
3. Change embedding/chat model
4. If embedding model changes: force reindex all docs (Settings warns you)

### Debug Search Issues
- Check Qdrant via http://localhost:6333/dashboard
- Review console logs for search queries and results
- Verify `userId` field in Qdrant payload for Goodreads docs
- Check filter structure in `lib/retrieval.ts`

## Code Style
- Uses Biome for linting/formatting (replaces ESLint + Prettier)
- TypeScript strict mode enabled
- CSS Modules for styling (not Tailwind)
- Functional React components with hooks
