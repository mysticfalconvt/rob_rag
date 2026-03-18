# RobRAG

A self-hosted RAG (Retrieval-Augmented Generation) application built with Next.js that transforms personal documents, books, calendar events, and emails into a searchable, conversational knowledge base. RobRAG automatically indexes content from multiple sources, creates semantic embeddings, and provides an interactive chat interface powered by local LLMs.

## Features

- **Multi-Source RAG**: Index and search across local files, Goodreads books, Paperless-ngx documents, Google Calendar events, and email (Gmail/Zoho)
- **Intelligent Retrieval**: Smart query routing, iterative refinement, tag-based score boosting, and source-specific filtering
- **Chat Interface**: Interactive Q&A with streaming responses, conversation history, and source attribution
- **Tool-Based Agents**: LLM can invoke tools mid-conversation — search knowledge base, check calendar, search email, create reminders, take notes, and search the web
- **Matrix Chat Bot**: Use RobRAG as a Matrix bot — invite it to rooms for RAG-powered responses and scheduled reminders
- **Vision OCR**: Process scanned PDFs using a vision model to produce searchable markdown
- **Global Tagging**: Auto-generate tags via LLM analysis with an approval workflow; tags boost search relevance
- **Background Scheduling**: Unified daily sync for all external data sources, cron-based reminders, and task execution tracking
- **Authentication**: Session-based auth with role-based access (admin/user) and CSRF protection
- **File Management**: Browse, upload, and manage indexed documents through a web interface
- **Real-time Updates**: Automatic file watching and re-indexing on changes
- **Web Search**: Integrates with SearXNG and Perplexica for web-augmented answers
- **LLM Analytics**: Token usage tracking, latency metrics, and cost monitoring

## Tech Stack

- **Framework**: Next.js 16 with TypeScript and App Router
- **Database**: PostgreSQL 16 with pgvector extension (vector embeddings + metadata)
- **ORM**: Prisma
- **LLM**: LM Studio (local inference API)
- **Embeddings**: LM Studio API (default: nomic-embed-text, 1024 dimensions)
- **Chat Orchestration**: LangChain
- **Auth**: iron-session with bcrypt
- **File Watching**: chokidar
- **Document Processing**: pdf-parse, mammoth, gray-matter, pdf2pic
- **OCR**: GraphicsMagick + Ghostscript + vision model
- **Matrix**: matrix-js-sdk
- **Email**: imapflow + mailparser (Zoho), googleapis (Gmail)
- **Web Search**: SearXNG / Perplexica
- **Containerization**: Docker Compose

## Prerequisites

- Node.js 18+ and pnpm
- Docker and Docker Compose
- LM Studio running locally with an embedding model and chat model loaded

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd rob_rag
pnpm install
```

### 2. Set Up Environment Variables

Copy `.env.example` to `.env.local` and configure:

```env
# Database
DATABASE_URL=postgresql://robrag:password@localhost:4344/robrag_dev
USE_POSTGRES_VECTORS=true

# LM Studio
LM_STUDIO_API_URL=http://localhost:1234/v1
LM_STUDIO_API_KEY=lm-studio
EMBEDDING_MODEL_NAME=nomic-embed-text
CHAT_MODEL_NAME=llama-3.2-1b-instruct

# Application
APP_NAME=RobRAG
DOCUMENTS_FOLDER_PATH=./documents
SESSION_SECRET=<openssl rand -base64 32>

# Admin User (auto-created on first launch)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme
ADMIN_NAME=Administrator

# Webhooks & Internal Auth
WEBHOOK_SECRET=<openssl rand -hex 32>
INTERNAL_SERVICE_KEY=<openssl rand -hex 32>

# Timezone
USER_TIMEZONE=America/New_York
```

See `.env.example` for additional optional variables (Google OAuth, Paperless, SearXNG, etc.).

### 3. Start Database

```bash
docker-compose up -d postgres-dev
```

### 4. Start LM Studio

1. Download and install [LM Studio](https://lmstudio.ai/)
2. Load an embedding model (e.g., `nomic-embed-text`)
3. Load a chat model (e.g., `llama-3.2-1b-instruct`)
4. Start the local server on port 1234

### 5. Set Up Database

```bash
pnpm prisma migrate dev
```

### 6. Run the Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 7. Index Your Documents

Place documents in the folder specified by `DOCUMENTS_FOLDER_PATH`. The app will automatically watch for new files, process and chunk them, generate embeddings, and store them in PostgreSQL with pgvector.

You can also manually trigger indexing via the Status page or API endpoints.

## Usage

### Chat Interface

1. Navigate to the home page
2. Ask questions about your indexed documents
3. Use the source filter bar to narrow searches to specific data sources
4. The system retrieves relevant chunks and generates answers using your local LLM
5. The LLM can invoke tools (calendar lookup, email search, web search, reminders) as needed

### File Management

- Visit `/files` to browse indexed documents
- Upload new documents via the upload interface
- View file contents and metadata
- Files are automatically re-indexed when modified

### Status & Configuration

- `/status` — System health, index statistics, connection status, sync controls, reindexing
- `/config` — Configure integrations (Paperless, Goodreads, Google Calendar, Email, Matrix, OCR)
- `/tags` — Manage the global tag system
- `/admin` — User management and LLM usage metrics
- `/scheduled` — View and manage scheduled tasks and reminders
- `/settings` — LLM model selection, system prompts, context window settings

## Document Sources

### Local Files
Watches `DOCUMENTS_FOLDER_PATH` for PDF, DOCX, Markdown, and plain text files. Supports subdirectories.

### Goodreads Integration
Import your reading history and make it searchable. Configure via `/config`:
1. Add a Goodreads user
2. Import your library via CSV export or set up RSS auto-sync
3. Reindex to make books searchable

Ask questions like: "What Brandon Sanderson books have I read?" or "What 5-star books did I read in 2024?"

### Paperless-ngx Integration
Connect to your Paperless-ngx instance. Configure URL and API token in `/config`. Documents are automatically indexed and searchable.

### Google Calendar Integration
Sync calendar events via OAuth. Configure in `/config`:
1. Set up Google OAuth credentials (see `GOOGLE_CALENDAR_SETUP.md`)
2. Authorize in the config page
3. Events are synced daily and searchable

Ask questions like: "What meetings do I have today?" or "When was my last dentist appointment?"

### Email Integration
Connect Gmail (OAuth) or Zoho (IMAP) email accounts. Configure in `/config`. The LLM can search, read, and manage emails via tool calls.

### Custom OCR
Process scanned PDFs using a vision model:
1. Configure a vision model in settings
2. Upload PDFs or trigger OCR from the file browser
3. Originals stored in `Custom_Docs/originals`, markdown output in `Custom_Docs/markdown`

### Web Search
Augment answers with web results via SearXNG or Perplexica. Set `SEARXNG_URL` or `PERPLEXICA_URL` in environment.

## Matrix Chat Bot

RobRAG can act as a Matrix chat bot:
1. Configure Matrix homeserver and credentials in `/config`
2. Invite the bot to Matrix rooms
3. The bot processes messages through the RAG pipeline and responds
4. Supports scheduled reminders via cron expressions
5. Configure allowed users and per-room RAG settings

See `MATRIX_INTEGRATION_PLAN.md` for architecture details.

## Docker Deployment

### Production Stack

```bash
docker-compose up -d
```

Services:
- **app**: Next.js application (port 4345 → 3000)
- **postgres-prod**: PostgreSQL 16 with pgvector (internal network only)
- **postgres-dev**: Development database (port 4344, optional)

The `docker-entrypoint.sh` handles migrations automatically on container startup — backs up the database, applies pending migrations, validates schema, then starts the app.

```bash
# Update to latest
docker-compose pull
docker-compose up -d
```

See `DEPLOY.md` and `DOCKER_SETUP.md` for detailed deployment instructions.

## API Endpoints

### Core
- `POST /api/chat` — RAG-powered chat with streaming
- `POST /api/chat-direct` — Direct LLM (no retrieval)
- `GET /api/status` — System status and statistics
- `GET /api/health` — Health check

### Documents & Files
- `GET /api/files` — List indexed files
- `GET /api/files/[...path]` — Get file contents
- `POST /api/upload` — Upload a document
- `POST /api/scan` — Scan all sources
- `POST /api/scan/source` — Scan specific source
- `POST /api/reindex` — Re-index all files
- `POST /api/reindex/source` — Re-index specific source

### Conversations
- `GET /api/conversations` — List conversations
- `POST /api/conversations` — Create conversation
- `GET /api/conversations/[id]` — Get conversation
- `DELETE /api/conversations/[id]` — Delete conversation

### Tags & Documents
- `GET/POST/PATCH /api/tags` — Tag management
- `POST /api/documents/[id]/generate-tags` — Auto-generate tags

### Integrations
- `GET/POST /api/goodreads/users` — Goodreads user management
- `POST /api/goodreads/sync` — Sync Goodreads RSS
- `POST /api/goodreads/sync-all` — Sync all Goodreads users
- `GET /api/google/auth` — Google OAuth flow
- `GET/POST /api/matrix/config` — Matrix bot configuration
- `GET/POST/PATCH /api/matrix/rooms` — Matrix room management
- `POST /api/matrix/send` — Send Matrix message
- `GET/POST /api/email/accounts` — Email account management
- `POST /api/email/search` — Search emails
- `POST /api/ocr/process` — Trigger OCR processing
- `POST /api/webhooks/sync-all` — Webhook sync trigger

### Admin
- `GET/POST /api/auth/users` — User management
- `GET /api/admin/llm-metrics` — Token usage analytics
- `GET/PATCH /api/settings` — Global settings
- `GET/POST /api/models` — LLM model management

## Development

### Scripts

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run Biome linter
pnpm format       # Format code with Biome
```

### Database Migrations

```bash
pnpm prisma migrate dev --name description_here   # Create and apply migration
pnpm prisma studio                                 # Open Prisma Studio
```

## Supported File Types

- PDF (`.pdf`) — with optional vision OCR for scanned documents
- Microsoft Word (`.docx`)
- Markdown (`.md`) — with YAML frontmatter support
- Plain Text (`.txt`)

## License

[Add your license here]
