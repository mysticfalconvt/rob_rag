# Next.js RAG System - Comprehensive Implementation Plan

## Phase 1: Project Setup & Infrastructure

### 1.1 Initialize Project
- [ ] Create Next.js 14+ project with TypeScript and App Router
- [ ] Configure TypeScript with strict mode
- [ ] Install core dependencies:
  - `@qdrant/js-client-rest` - Qdrant vector DB client
  - `langchain` - RAG orchestration
  - `chokidar` - File system watching
  - `pdf-parse` - PDF processing
  - `mammoth` - Word doc processing (if needed)
  - `gray-matter` - Markdown frontmatter parsing
  
- [ ] Set up Font Awesome Web Components integration

### 1.2 Environment Configuration
- [ ] Create `.env.local` with:
  - `LM_STUDIO_API_URL` (default: http://localhost:1234/v1)
  - `LM_STUDIO_API_KEY` (if needed)
  - `QDRANT_URL` (default: http://localhost:6333)
  - `DOCUMENTS_FOLDER_PATH` (watched folder location)
  - `EMBEDDING_MODEL_NAME` (e.g., nomic-embed-text)
  - `CHAT_MODEL_NAME` (your LM Studio chat model)
- [ ] Create config file to load and validate environment variables

### 1.3 Docker Setup
- [ ] Create `docker-compose.yml` for Qdrant
- [ ] Configure Qdrant with persistent volume
- [ ] Add documentation for starting services
- [ ] Test Qdrant connection

## Phase 2: Database & Data Models

### 2.1 Qdrant Setup
- [ ] Create utility to initialize Qdrant client
- [ ] Define collection schema with metadata fields:
  - `filePath` (full path)
  - `fileName` (just name)
  - `parentFolder` (immediate parent)
  - `fileType` (extension)
  - `chunkIndex` (position in file)
  - `totalChunks` (total for file)
  - `fileHash` (for change detection)
  - `indexedAt` (timestamp)
- [ ] Create collection initialization script
- [ ] Add vector dimension configuration (match embedding model)

### 2.2 File Metadata Tracking (SQLite)
- [ ] Set up Prisma or Drizzle ORM
- [ ] Create schema for `indexed_files` table:
  - `id`, `filePath`, `fileHash`, `lastModified`, `lastIndexed`, `chunkCount`, `status`
- [ ] Generate migration files
- [ ] Create DB utility functions

## Phase 3: Core RAG Pipeline

### 3.1 LM Studio Integration
- [ ] Create LM Studio API client wrapper
- [ ] Implement embedding generation function
  - Test with sample text
  - Handle rate limiting/errors
- [ ] Implement chat completion function
  - Support streaming responses
  - Handle context window limits
- [ ] Add retry logic and error handling

### 3.2 Document Processing
- [ ] Create document loader factory (supports .txt, .md, .pdf, code files)
- [ ] Implement text chunking strategy:
  - Define chunk size (default: 800 chars)
  - Define chunk overlap (default: 200 chars)
  - Handle code-specific chunking (respect function boundaries)
- [ ] Create file path parser to extract metadata
- [ ] Implement full path preservation in chunks

### 3.3 Embedding & Indexing Pipeline
- [ ] Create function to process single file:
  - Load and parse file
  - Extract metadata (full path, parent folder, etc.)
  - Split into chunks
  - Generate embeddings for each chunk
  - Store in Qdrant with metadata
  - Update SQLite tracking
- [ ] Create batch processing function for multiple files
- [ ] Add duplicate detection (via file hash)
- [ ] Implement update logic (detect changes, remove old chunks, re-index)

### 3.4 Retrieval System
- [ ] Create semantic search function:
  - Convert query to embedding
  - Search Qdrant with similarity threshold
  - Return top K chunks (default: 5)
- [ ] Implement result post-processing:
  - De-duplicate results from same file
  - Sort by relevance score
  - Format with source metadata
- [ ] Create context builder for LLM prompts

## Phase 4: File Monitoring System

### 4.1 File Watcher
- [ ] Set up chokidar to watch documents folder
- [ ] Implement event handlers:
  - File added → trigger indexing
  - File modified → trigger re-indexing
  - File deleted → remove from Qdrant and SQLite
- [ ] Add debouncing (wait for file writes to complete)
- [ ] Log all file system events

### 4.2 Manual Scan Functionality
- [ ] Create API endpoint: `POST /api/scan`
- [ ] Implement full folder scan logic:
  - Recursively find all supported files
  - Check against indexed files (compare hashes)
  - Queue new/modified files for processing
- [ ] Return scan summary (files added/updated/removed)

### 4.3 Scheduled Scanning (Cron)
- [ ] Set up cron job (using `node-cron` or Vercel Cron)
- [ ] Configure overnight scan (e.g., 2 AM)
- [ ] Add logging for scheduled runs
- [ ] Create API endpoint: `POST /api/cron/scan` (protected)

## Phase 5: Backend API Routes

### 5.1 Chat API
- [ ] Create `POST /api/chat` endpoint:
  - Accept user message
  - Retrieve relevant chunks from Qdrant
  - Build prompt with context
  - Call LM Studio chat API
  - Stream response back to client
  - Return source file metadata
- [ ] Add conversation history support (in-memory or session-based)
- [ ] Implement error handling and fallbacks

### 5.2 File Management APIs
- [ ] `GET /api/files` - List all indexed files with metadata
- [ ] `DELETE /api/files/:path` - Remove file from index
- [ ] `POST /api/files/reindex/:path` - Force re-index specific file
- [ ] `GET /api/files/:path/chunks` - View chunks for a file (debugging)

### 5.3 System Status API
- [ ] `GET /api/status` - Return:
  - Qdrant connection status
  - LM Studio connection status
  - Total indexed files
  - Total chunks
  - Last scan time
  - Watcher status

## Phase 6: Frontend UI (React + Font Awesome Web Components)

### 6.1 Layout & Navigation
- [ ] Create root layout with Font Awesome setup
- [ ] Build main navigation (using FA web components for icons)
- [ ] Add responsive sidebar/header
- [ ] Implement dark mode toggle

### 6.2 Chat Interface
- [ ] Create chat page (`/app/page.tsx`)
- [ ] Build message list component:
  - User messages
  - Assistant messages with source attribution
  - Streaming message support
  - Code syntax highlighting
- [ ] Create chat input component
- [ ] Add "sources used" section showing file paths as clickable links
- [ ] Implement copy message functionality
- [ ] Add loading states and animations

### 6.3 File Management Dashboard
- [ ] Create files page (`/app/files/page.tsx`)
- [ ] Build file list table:
  - Show file path, type, chunk count, last indexed
  - Add search/filter functionality
  - Sort by various columns
- [ ] Add action buttons (re-index, delete) with FA icons
- [ ] Create file detail view modal
- [ ] Add "Scan Now" button triggering manual scan
- [ ] Show scan progress/results

### 6.4 System Status Page
- [ ] Create status page (`/app/status/page.tsx`)
- [ ] Display connection status indicators (Qdrant, LM Studio)
- [ ] Show indexing statistics (total files, chunks, storage)
- [ ] Add recent activity log
- [ ] Display current embedding/chat models

### 6.5 Settings Page (Optional for v1)
- [ ] Create settings page (`/app/settings/page.tsx`)
- [ ] Allow configuration of:
  - Chunk size and overlap
  - Number of retrieval results
  - Watched folder path
  - Model selection
- [ ] Add "Clear All Data" functionality

## Phase 7: Error Handling & Logging

### 7.1 Error Handling
- [ ] Create custom error classes for different failure types
- [ ] Implement try-catch blocks in all async operations
- [ ] Add user-friendly error messages in UI
- [ ] Create error boundary components

### 7.2 Logging System
- [ ] Set up logging library (Winston or Pino)
- [ ] Log all indexing operations
- [ ] Log API requests and responses
- [ ] Log file system events
- [ ] Create log viewer in UI (optional)

## Phase 8: Testing & Optimization

### 8.1 Testing
- [ ] Test with various file types
- [ ] Test with duplicate filenames in different folders
- [ ] Test file modifications and deletions
- [ ] Test edge cases (empty files, large files, special characters in paths)
- [ ] Test embedding generation with LM Studio
- [ ] Verify chunk metadata accuracy

### 8.2 Performance Optimization
- [ ] Implement batch embedding generation (multiple chunks at once)
- [ ] Add rate limiting for LM Studio API calls
- [ ] Optimize Qdrant queries (adjust top_k, score threshold)
- [ ] Add caching where appropriate
- [ ] Profile and optimize slow operations

### 8.3 Code Quality
- [ ] Add TypeScript types for all data structures
- [ ] Refactor duplicated code into utilities
- [ ] Add JSDoc comments for complex functions
- [ ] Review and clean up console.logs

## Phase 9: Documentation & Deployment

### 9.1 Documentation
- [ ] Create README with:
  - Project overview
  - Setup instructions
  - Environment variables reference
  - Supported file types
  - Architecture diagram
- [ ] Document API endpoints
- [ ] Add code comments for complex logic
- [ ] Create troubleshooting guide

### 9.2 Deployment Preparation
- [ ] Ensure all secrets are in environment variables
- [ ] Create production docker-compose (if needed)
- [ ] Test on clean machine/container
- [ ] Add health check endpoints
- [ ] Create backup/restore scripts for Qdrant data

## Phase 10: Nice-to-Haves (Post-MVP)

### 10.1 Enhanced Features
- [ ] Multiple document collections (different folders for different topics)
- [ ] Conversation history persistence (database)
- [ ] Export conversations
- [ ] Share conversations via link
- [ ] Keyword search alongside semantic search
- [ ] Highlight which parts of chunks were used
- [ ] Add file preview in UI

### 10.2 Advanced RAG Features
- [ ] Implement re-ranking of retrieved chunks
- [ ] Add metadata filtering (search only in specific folders/file types)
- [ ] Implement hybrid search (vector + keyword)
- [ ] Add query expansion/rephrasing
- [ ] Implement streaming chunk display during retrieval

### 10.3 UI Polish
- [ ] Add keyboard shortcuts
- [ ] Implement drag-and-drop file upload
- [ ] Add animations and transitions
- [ ] Create onboarding tour
- [ ] Add usage analytics dashboard

---

## Recommended Implementation Order

**Week 1: Foundation**
- Phase 1 (Setup)
- Phase 2 (Database)
- Phase 3.1-3.2 (LM Studio + Document Processing)

**Week 2: Core Pipeline**
- Phase 3.3-3.4 (Indexing + Retrieval)
- Phase 5.1 (Chat API)
- Phase 6.2 (Basic Chat UI)

**Week 3: File Management**
- Phase 4 (File Monitoring)
- Phase 5.2-5.3 (Management APIs)
- Phase 6.3-6.4 (Dashboard UI)

**Week 4: Polish**
- Phase 7 (Error Handling)
- Phase 8 (Testing)
- Phase 9 (Documentation)

---

## Tech Stack Summary

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Vector Database**: Qdrant (Docker)
- **Metadata Storage**: SQLite (Prisma/Drizzle)
- **LLM**: LM Studio (local API)
- **Embeddings**: LM Studio API (nomic-embed-text)
- **File Watching**: chokidar
- **UI Components**: React + Font Awesome Web Components
- **Document Processing**: pdf-parse, mammoth, gray-matter

---

This plan provides a complete roadmap for building a production-ready RAG system. Start with the foundation and iterate through each phase systematically!