# Sync Comparison: All Data Sources

## Overview

This document compares how different data sources handle syncing and indexing to understand efficiency and optimization opportunities.

---

## 1. **Google Calendar** (Newest)

### Sync Method
- **Manual trigger**: Click "Sync & Index" on `/config` page
- **No auto-sync**: Must manually trigger

### Sync Flow
```typescript
syncCalendarEvents()
  ↓
Fetches ALL events from Google Calendar API
  ↓
For each event:
  - Check if exists (by eventId)
  - If exists → UPDATE (only if data changed)
  - If new → CREATE
  ↓
Update googleLastSynced timestamp
```

### Indexing Flow
```typescript
indexCalendarEvents(onlyNew: true)  // ✅ Now incremental!
  ↓
Query events WHERE lastEmbedded IS NULL
  ↓
For each unindexed event:
  - Generate embedding
  - Create IndexedFile (upsert)
  - Create DocumentChunk
  - Update lastEmbedded timestamp
```

### Efficiency
- ✅ **Sync is efficient**: Uses upsert, only updates changed events
- ✅ **Indexing is incremental**: Only processes events without embeddings
- ❌ **No auto-sync**: Must manually trigger
- ✅ **Has real-time query**: `get_upcoming_events` bypasses index for fresh data

### Performance
- **Initial sync**: ~9-10 minutes for 5,814 events (one-time cost)
- **Subsequent syncs**: Only indexes new/changed events (seconds/minutes)

---

## 2. **Goodreads**

### Sync Method
- **Manual trigger**: Click sync button on `/config` page OR scan by source
- **No auto-sync**: Must manually trigger

### Sync Flow
```typescript
importBooksForUser(userId, books)
  ↓
For each book from RSS feed:
  - Check if exists (by userId + goodreadsBookId)
  - If exists → UPDATE (merge read dates, increment read count)
  - If new → CREATE
```

### Indexing Flow
```typescript
indexGoodreadsBooks(userId)
  ↓
DELETE all old DocumentChunks for this user  // ❌ Always deletes everything!
  ↓
For each book:
  - Generate embedding
  - Create IndexedFile (upsert)
  - Create DocumentChunk (raw SQL INSERT)
```

### Efficiency
- ✅ **Sync is efficient**: Only updates changed books
- ❌ **Indexing is NOT incremental**: Deletes ALL chunks, regenerates ALL embeddings
- ❌ **No auto-sync**: Must manually trigger
- ❌ **No real-time query**: All queries hit indexed database

### Performance
- **Every sync**: Regenerates embeddings for ALL books (expensive!)
- **Why**: Deletes all chunks first, then recreates everything

### Optimization Opportunity
```typescript
// Current (inefficient):
await prisma.documentChunk.deleteMany({
  where: { source: "goodreads", userId: userId }
});
// Then recreate everything

// Better approach:
// Check if book already has embedding, skip if unchanged
```

---

## 3. **Paperless-ngx**

### Sync Method
- **Manual trigger**: Scan by source on status page
- **No auto-sync**: Must manually trigger

### Sync Flow
```typescript
scanPaperlessDocuments()
  ↓
Fetch ALL documents from Paperless API
  ↓
For each document:
  - Check if indexed and hash matches
  - If hash differs → reindex
  - If new → index
```

### Indexing Flow
```typescript
indexPaperlessDocument(doc)
  ↓
Hash = crypto.hash(content + modifiedDate)
  ↓
If existing.fileHash === newHash → SKIP (✅ efficient!)
  ↓
Otherwise:
  - Delete old DocumentChunks for this doc
  - Generate new chunks
  - Generate embeddings
  - Create IndexedFile (upsert)
  - Create DocumentChunks
```

### Efficiency
- ✅ **Sync is efficient**: Only reindexes if hash changed
- ✅ **Indexing is incremental**: Skips unchanged documents via hash check
- ❌ **No auto-sync**: Must manually trigger
- ❌ **No real-time query**: All queries hit indexed database

### Performance
- **Scans all docs** but only reindexes changed ones (hash-based)
- **Much better than Goodreads**: Doesn't regenerate everything

---

## 4. **Local Files**

### Sync Method
- **Manual trigger**: Scan files on status page
- **Auto-detection**: Hash check determines if reindexing needed

### Sync Flow
```typescript
scanAllFiles()
  ↓
getAllFiles(DOCUMENTS_FOLDER_PATH)
  ↓
For each file:
  - Calculate hash
  - If hash differs from indexed → reindex
  - If new → index
```

### Indexing Flow
```typescript
indexFile(filePath)
  ↓
currentHash = getFileHash(filePath)
existingRecord = findInDB(filePath)
  ↓
If existingRecord.fileHash === currentHash → SKIP (✅ efficient!)
  ↓
Otherwise:
  - Delete old DocumentChunks
  - Process file into chunks
  - Generate embeddings
  - Create IndexedFile (upsert)
  - Create DocumentChunks
```

### Efficiency
- ✅ **Sync is efficient**: Only reindexes modified files via hash check
- ✅ **Indexing is incremental**: Skips unchanged files
- ❌ **No auto-sync**: Must manually trigger
- ❌ **No real-time query**: All queries hit indexed database

### Performance
- **Hash-based detection**: Very efficient, only processes changed files
- **Similar to Paperless**: Uses hash to avoid unnecessary work

---

## Comparison Table

| Feature | Google Calendar | Goodreads | Paperless | Local Files |
|---------|----------------|-----------|-----------|-------------|
| **Auto-sync** | ❌ No | ❌ No | ❌ No | ❌ No |
| **Incremental indexing** | ✅ Yes (new) | ❌ No | ✅ Yes (hash) | ✅ Yes (hash) |
| **Duplicate detection** | ✅ eventId | ✅ bookId | ✅ Hash | ✅ Hash |
| **Real-time query** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Deletes everything** | ❌ No | ✅ Yes | ❌ No | ❌ No |
| **Skips unchanged** | ✅ Yes | ❌ No | ✅ Yes | ✅ Yes |

---

## Efficiency Ranking

### Most Efficient → Least Efficient

1. **Local Files** & **Paperless** (Tied)
   - Hash-based change detection
   - Only reindexes what changed
   - No unnecessary API calls or embeddings

2. **Google Calendar** (New incremental mode)
   - Tracks lastEmbedded timestamp
   - Only indexes new/unembedded events
   - Has real-time query option

3. **Goodreads** (Least efficient)
   - Deletes ALL chunks every sync
   - Regenerates ALL embeddings every time
   - No skip logic for unchanged books

---

## Optimization Recommendations

### 1. **Goodreads** - Needs Optimization!

**Current Problem:**
```typescript
// Deletes everything, regenerates everything
await prisma.documentChunk.deleteMany({
  where: { source: "goodreads", userId: userId }
});
```

**Proposed Fix:**
```typescript
// Only reindex changed books
for (const book of books) {
  const existing = await prisma.indexedFile.findUnique({
    where: { filePath: `goodreads://${userId}/${book.id}` }
  });

  // Skip if book hasn't changed since last index
  if (existing && existing.lastModified >= book.updatedAt) {
    console.log(`Skipping unchanged book: ${book.title}`);
    continue;
  }

  // Only delete chunks for THIS book
  await prisma.documentChunk.deleteMany({
    where: { bookId: book.id }
  });

  // Generate embedding and index
  // ...
}
```

**Estimated Impact:**
- Current: Reindexes 100 books every sync (100 API calls)
- Optimized: Reindexes 5-10 changed books (5-10 API calls)
- **Savings: 90-95% reduction in embedding API calls**

---

### 2. **Auto-sync** - Not Implemented Anywhere

**Current State:**
- All syncs are manual
- User must remember to click "Sync"

**Possible Solutions:**

#### Option A: Cron Job (Server-side)
```typescript
// Run every hour
cron.schedule('0 * * * *', async () => {
  await syncCalendarEvents();
  await indexCalendarEvents(true);
});
```

#### Option B: Scheduled API Routes
- Use Vercel Cron Jobs or similar
- Trigger sync endpoints on schedule

#### Option C: Client-side polling
- Sync automatically when user opens app
- Check if last sync was > N hours ago

---

### 3. **Real-time Queries** - Only Calendar Has This

**Current State:**
- Only Google Calendar has `get_upcoming_events` tool
- Bypasses index for real-time data

**Possible Additions:**
- Paperless: Real-time query for "recently added docs"
- Goodreads: Real-time query for "currently reading"

---

## Summary

### What Works Well
- ✅ Hash-based change detection (Local, Paperless)
- ✅ Incremental indexing (Calendar, Local, Paperless)
- ✅ Upsert logic prevents duplicates (all sources)

### What Needs Work
- ❌ Goodreads reindexes everything (very inefficient)
- ❌ No auto-sync anywhere (manual only)
- ❌ Limited real-time query capabilities

### Quick Wins
1. **Fix Goodreads indexing** - Add incremental logic (biggest impact)
2. **Add auto-sync** - At least for Calendar (most time-sensitive)
3. **Expose sync status** - Show last synced time everywhere

### Long-term Ideas
- Webhook support for instant updates (Paperless, Calendar)
- Background job queue for async indexing
- Delta sync using API-provided sync tokens (Google Calendar supports this)
