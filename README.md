# RobRAG

A RAG (Retrieval-Augmented Generation) application built with Next.js that enables document-based question answering. RobRAG automatically indexes documents from a watched folder, creates semantic embeddings, and provides an interactive chat interface to query your documents.

## Features

- **Document Indexing**: Automatically indexes PDF, DOCX, Markdown, and plain text files
- **Semantic Search**: Uses vector embeddings for intelligent document retrieval
- **Chat Interface**: Interactive Q&A interface powered by local LLMs via LM Studio
- **File Management**: Browse and manage indexed documents through a web interface
- **Conversation History**: Save and manage chat conversations
- **Real-time Updates**: Automatically re-indexes files when they change
- **Goodreads Integration**: Import and query your reading history from Goodreads
- **Paperless-ngx Integration**: Connect to Paperless-ngx for document management

## Tech Stack

- **Framework**: Next.js 16 with TypeScript and App Router
- **Vector Database**: Qdrant (via Docker)
- **Metadata Storage**: SQLite with Prisma ORM
- **LLM**: LM Studio (local API)
- **Embeddings**: LM Studio API (configurable models)
- **File Watching**: chokidar for automatic file monitoring
- **Document Processing**: pdf-parse, mammoth, gray-matter

## Prerequisites

- Node.js 18+ and pnpm (or npm/yarn)
- Docker and Docker Compose (for Qdrant)
- LM Studio running locally with an embedding model and chat model loaded

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd rob_rag
pnpm install
```

### 2. Set Up Environment Variables

Create a `.env.local` file in the root directory:

```env
# LM Studio Configuration
LM_STUDIO_API_URL=http://localhost:1234/v1
LM_STUDIO_API_KEY=  # Optional, if your LM Studio requires an API key

# Qdrant Configuration
QDRANT_URL=http://localhost:6333

# Document Folder
DOCUMENTS_FOLDER_PATH=./documents

# Model Configuration
EMBEDDING_MODEL_NAME=nomic-embed-text
CHAT_MODEL_NAME=llama-3.2-1b-instruct

# Optional: Customize App Name
APP_NAME=RobRAG
```

### 3. Start Qdrant

```bash
docker-compose up -d
```

This starts Qdrant on `http://localhost:6333`.

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

Place documents in the folder specified by `DOCUMENTS_FOLDER_PATH`. The app will automatically:
- Watch for new files
- Process and chunk documents
- Generate embeddings
- Store them in Qdrant

You can also manually trigger indexing via the Status page or API endpoints.

## Usage

### Chat Interface

1. Navigate to the home page (default chat interface)
2. Ask questions about your indexed documents
3. The system will retrieve relevant chunks and generate answers using your LLM

### File Management

- Visit `/files` to browse indexed documents
- View file contents and metadata
- Files are automatically re-indexed when modified

### Status Page

- Visit `/status` to check system health
- View indexing status
- Monitor Qdrant and LM Studio connections
- Configure Paperless-ngx integration
- Manage Goodreads RSS feeds
- Reindex specific document sources

## Configuration

### Customizing the App Name

Set the `APP_NAME` environment variable to customize the application title shown in the sidebar:

```env
APP_NAME=My Custom RAG App
```

### Supported File Types

- PDF (`.pdf`)
- Microsoft Word (`.docx`)
- Markdown (`.md`)
- Plain Text (`.txt`)

## Integrations

### Goodreads Integration

Query your reading history using natural language! RobRAG can import your Goodreads library and make it searchable.

#### Setup

1. **Create a User**
   - Go to `/status` page
   - Under "Goodreads Users", click "Add User"
   - Enter your name

2. **Import Your Library (One-time)**
   - Export your Goodreads library as CSV:
     - Go to [Goodreads My Books](https://www.goodreads.com/review/list)
     - Click "Import and export" at the bottom
     - Click "Export Library"
   - Use the API to upload your CSV:
     ```bash
     curl -X POST http://localhost:3000/api/goodreads/upload-csv \
       -F "userId=YOUR_USER_ID" \
       -F "file=@goodreads_library_export.csv"
     ```

3. **Set Up RSS Auto-Sync**
   - Get your Goodreads RSS feed URL:
     - Go to your Goodreads profile
     - Look for "RSS" link or construct: `https://www.goodreads.com/review/list_rss/YOUR_USER_ID?key=YOUR_KEY&shelf=%23ALL%23`
   - Add RSS feed via API:
     ```bash
     curl -X POST http://localhost:3000/api/goodreads/rss \
       -H "Content-Type: application/json" \
       -d '{"userId":"YOUR_USER_ID","rssFeedUrl":"YOUR_RSS_URL"}'
     ```

4. **Sync Your Library**
   - Manual sync via API:
     ```bash
     curl -X POST http://localhost:3000/api/goodreads/sync \
       -H "Content-Type: application/json" \
       -d '{"userId":"YOUR_USER_ID"}'
     ```
   - Or sync all users:
     ```bash
     curl -X POST http://localhost:3000/api/goodreads/sync-all
     ```
   - Tip: Set up a cron job to sync periodically

5. **Index Your Books**
   - Go to `/status` page
   - Click "Reindex Goodreads" button
   - Your books are now searchable!

#### Usage

Ask questions like:
- "What Brandon Sanderson books have I read?"
- "What 5-star books did I read in 2024?"
- "Show me books I've read multiple times"
- "What science fiction books are on my to-read shelf?"

#### Features

- **Read History Tracking**: Automatically tracks when you read/reread books
- **Multiple Read Dates**: Stores all dates you've read a book, not just the most recent
- **Read Count**: Automatically increments when RSS feed shows a new read date
- **Metadata**: Stores ratings, reviews, shelves, dates, page counts, and more
- **Smart Updates**: RSS sync only updates changed data, preserves read count from CSV imports

#### API Endpoints

- `GET /api/goodreads/users` - List all users
- `POST /api/goodreads/users` - Create a new user
- `POST /api/goodreads/upload-csv` - Upload Goodreads CSV export
- `POST /api/goodreads/rss` - Configure RSS feed for a user
- `POST /api/goodreads/sync` - Sync one user's RSS feed
- `POST /api/goodreads/sync-all` - Sync all users' RSS feeds
- `POST /api/reindex/source` - Reindex specific source (including `goodreads`)

### Paperless-ngx Integration

Connect to your Paperless-ngx instance to search your document archive.

#### Setup

1. Go to `/status` page
2. Scroll to "Paperless-ngx Configuration"
3. Enter your Paperless-ngx URL and API token
4. Save settings
5. Documents will be automatically indexed and searchable

## API Endpoints

- `GET /api/status` - System status and health checks
- `GET /api/files` - List indexed files
- `GET /api/files/[...path]` - Get file contents
- `POST /api/upload` - Upload a file
- `POST /api/scan` - Manually trigger file scanning
- `POST /api/reindex` - Re-index all files
- `POST /api/chat` - Chat endpoint
- `GET /api/conversations` - List conversations
- `POST /api/conversations` - Create conversation
- `GET /api/conversations/[id]` - Get conversation
- `DELETE /api/conversations/[id]` - Delete conversation

## Development

### Scripts

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run linter
pnpm format       # Format code
```

### Database Migrations

```bash
pnpm prisma migrate dev    # Create and apply migration
pnpm prisma studio        # Open Prisma Studio
```

## License

[Add your license here]
