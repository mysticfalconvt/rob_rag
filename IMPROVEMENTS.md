# RAG System Improvements

## Overview
This document outlines planned improvements to enhance the RAG chat system's intelligence, performance, and user experience.

---

## 1. Show Only Referenced Sources (with "View All" option)

**Problem:** Currently all retrieved chunks are displayed as sources, even if the LLM didn't actually use them in the response.

**Solution:** Automatically detect which chunks were actually referenced in the response and show those by default, with a button to expand and view all retrieved chunks.

**Benefits:**
- Cleaner UI with less clutter
- More transparent about what information actually informed the answer
- Still keeps full context available for users who want to investigate

**Implementation Notes:**
- Add post-processing step to match response content to retrieved chunks
- Could use embeddings similarity, LLM-based analysis, or citation markers
- Update frontend to handle `referencedSources` vs `allSources`

---

## 2. Smart Chunk Count (Auto-sizing)

**Problem:** Users must manually set chunk count via slider, same count used for all queries regardless of complexity.

**Solution:** Automatically determine optimal number of chunks based on query characteristics.

**Options:**
- **A) Query Heuristic:** Analyze query complexity (length, keywords, question type) and adjust chunk count accordingly
- **B) Agentic RAG:** Start small, let LLM request more context via function calling if needed
- **C) Confidence-Based:** Start with default, retry with more chunks if response shows uncertainty

**Benefits:**
- Simpler queries don't waste tokens/time
- Complex queries automatically get more context
- Better UX - one less thing for users to configure

**Implementation Notes:**
- Start with Option A or C (simpler, no function calling required)
- Could keep slider as "max chunks" or advanced option
- Track performance to tune heuristics

---

## 3. Tool Calls for Structured Data Sources

**Problem:** Vector search doesn't leverage structured metadata from Goodreads (ratings, dates, genres) or Paperless (document types, tags, dates).

**Solution:** Add LangChain function calling tools for metadata-based queries.

**Example Tools:**
- `search_goodreads_by_rating(min_rating, max_rating, genre?, author?)`
- `search_goodreads_by_date(start_date, end_date)`
- `search_paperless_by_metadata(tags[], date_range?, doc_type?)`

**Benefits:**
- Enable precise queries like "books I rated 5 stars about history"
- Leverage structured data that embeddings can't capture well
- More accurate results for metadata-specific questions

**Implementation Notes:**
- Requires LLM with good function calling support
- Add tools to LangChain chain
- LLM decides when to use vector search vs tools vs both
- May need to create database queries for metadata access

---

## 4. Multi-Model Support (Fast & Slow)

**Problem:** All operations use the same model, even quick pre-processing tasks that don't need the most powerful model.

**Solution:** Configure two models - a fast/small model for pre-processing and a slow/large model for final responses.

**Use Cases for Fast Model:**
- Query rephrasing for search (app/api/chat/route.ts:124-132)
- Title generation (route.ts:350-374)
- Topic extraction (route.ts:378-380)
- Context summarization (if enabled)
- Source reference detection (for improvement #1)

**Use Cases for Slow Model:**
- Main chat response generation
- Complex reasoning tasks
- Final user-facing content

**Benefits:**
- Significant performance improvement for multi-step operations
- Lower cost/resource usage for auxiliary tasks
- Better UX - faster response times for operations that don't need heavy model

**Implementation Notes:**
- Add "Fast Model" and "Main Model" settings to admin config
- Update `lib/ai.ts` to export `getFastChatModel()` and `getChatModel()`
- Update route handlers to use appropriate model for each task
- Consider fallback to main model if fast model unavailable
- Fast model should still be capable enough for reasoning tasks (20B models typically sufficient)

**Example Configuration:**
- Fast: `gpt-oss-20b` - for rephrasing, titles, metadata extraction
- Main: `gpt-oss-120b` - for final responses to user

---

## Implementation Priority

1. **#1 - Referenced Sources** - Best immediate UX improvement, moderate complexity
2. **#4 - Multi-Model** - Significant performance gains, relatively easy to implement
3. **#2 - Smart Chunk Count** - Good UX improvement, start with simple heuristics
4. **#3 - Tool Calls** - Most powerful but requires most infrastructure changes

---

## Notes

- All improvements should maintain backward compatibility
- Track metrics (response time, token usage, user satisfaction) before/after
- Consider feature flags for gradual rollout
- Document changes for users in UI help text
