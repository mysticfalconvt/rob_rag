# RAG System Improvements

## Overview
This document tracks planned and completed improvements to enhance the RAG chat system.

---

## ✅ Completed Improvements

### 1. Show Only Referenced Sources ✅
- **Status:** Implemented with embedding-based similarity analysis
- **Implementation:** `lib/sourceAnalysis.ts` with adaptive thresholding
- **UI:** `components/SourceCitation.tsx` with toggle to view all sources

### 2. Smart Retrieval System ✅
- **Status:** Implemented with query classification and two-stage retrieval
- **Implementation:** `lib/smartRetrieval.ts`
- **Features:**
  - Auto-detects query type (book/document/general)
  - Auto-selects sources based on query analysis
  - Auto-determines chunk count based on complexity (5/10/20)
  - Two-stage search: probe all sources, then focus on best performers

### 3. Iterative Retrieval ✅
- **Status:** Implemented with preview check using fast model
- **Implementation:** `lib/iterativeRetrieval.ts`
- **Features:**
  - Preview generation checks if more context needed
  - Auto-retrieves additional chunks if LLM shows uncertainty
  - Deduplicates results by content

### 4. Multi-Model Support ✅
- **Status:** Implemented with fast/main model configuration
- **Implementation:** `lib/ai.ts` - `getFastChatModel()` and `getChatModel()`
- **Use Cases:**
  - Fast model: query rephrasing, title generation, topic extraction, iterative analysis
  - Main model: final response generation

---

## ✅ Completed Improvements (continued)

### 5. Data Source Plugin Architecture ✅
- **Status:** Implemented with plugin registry and query builder
- **Implementation:** `lib/dataSourceRegistry.ts`, `lib/queryBuilder.ts`, `lib/plugins/`
- **Features:**
  - Plugin interface for all data sources
  - Centralized metadata schema registry
  - Fluent query builder for Qdrant filters
  - Three plugins: Goodreads, Paperless, Files
  - Auto-initialization on app startup

### 6. Tool Calls for Structured Metadata Queries ✅
- **Status:** Implemented with automatic tool generation from plugins
- **Implementation:** `lib/toolGenerator.ts`, integrated into chat API
- **Features:**
  - Auto-generates LangChain tools from plugin metadata schemas
  - 8 total tools across 3 data sources
  - Model compatibility detection
  - Tool execution before final response generation

**Available Tools:**
- Goodreads: `search_goodreads_by_rating`, `search_goodreads_by_date_read`, `search_goodreads_by_author`
- Paperless: `search_paperless_by_tags`, `search_paperless_by_correspondent`, `search_paperless_by_date`
- Files: `search_files_by_type`, `search_uploaded_files`

---

## 🚧 Previously In Progress (Now Complete)

### 5. Data Source Plugin Architecture (COMPLETED)

**Problem:** Current architecture has hardcoded data sources (goodreads, paperless, uploaded, synced) making it difficult to add new sources or implement metadata-based tool calling.

**Solution:** Created a plugin/registry system with standardized interfaces for data sources.

**Architecture Components:**

1. **Data Source Plugin Interface** (`lib/dataSourceRegistry.ts`)
   ```typescript
   interface DataSourcePlugin {
     name: string;
     displayName: string;
     capabilities: {
       supportsMetadataQuery: boolean;
       supportsSemanticSearch: boolean;
     };
     getMetadataSchema(): MetadataField[];
     queryByMetadata(params: QueryParams): Promise<SearchResult[]>;
     getAvailableTools(): ToolDefinition[];
     scan(): Promise<ScanResult>;
   }
   ```

2. **Query Builder Abstraction** (`lib/queryBuilder.ts`)
   - Centralized Qdrant filter construction
   - Supports chaining: `.source().filter().dateRange().build()`
   - Replaces hardcoded filter logic in `lib/retrieval.ts`

3. **Standardized Qdrant Payload**
   ```typescript
   {
     content: string,
     source: string,
     filePath: string,
     fileName: string,
     fileType: string,
     userId?: string,
     metadata: {
       // Source-specific fields nested here
       [key: string]: any
     }
   }
   ```

4. **Refactor Existing Sources**
   - Goodreads plugin implementation
   - Paperless plugin implementation
   - Files plugin implementation
   - Update indexing to use standardized payload structure

**Benefits:**
- Easy to add new data sources (hours instead of days)
- Auto-generate tool calling functions from plugin metadata
- Centralized metadata registry for query capabilities
- Better separation of concerns

**Implementation Steps:**
1. Create plugin interface and registry
2. Create query builder abstraction
3. Refactor Goodreads as first plugin
4. Refactor Paperless and Files plugins
5. Update retrieval logic to use registry
6. Update indexing to use standardized payload

---

## 📋 Future Enhancements

### Potential Next Steps

1. **Multi-turn Tool Calling** - Allow LLM to make multiple tool calls in sequence if needed
2. **Tool Call Caching** - Cache common metadata queries to reduce latency
3. **Hybrid Search** - Combine metadata filtering with semantic search in single query
4. **Plugin Marketplace** - Easy way to discover and install community plugins
5. **Advanced Query Operators** - Support for "contains", "starts with", regex patterns
6. **Cross-Plugin Queries** - Query across multiple data sources in one tool call

---

## Implementation Priority

1. ✅ ~~Referenced Sources Detection~~
2. ✅ ~~Multi-Model Support~~
3. ✅ ~~Smart Retrieval with Auto Source Selection~~
4. ✅ ~~Iterative Retrieval~~
5. ✅ ~~Data Source Plugin Architecture~~
6. ✅ ~~Tool Calls for Metadata Queries~~

**All planned improvements complete!** 🎉

---

## Notes

- Plugin architecture is prerequisite for effective tool calling
- All changes maintain backward compatibility
- Standardized payload will require re-indexing existing data
- Consider migration script for existing Qdrant vectors
