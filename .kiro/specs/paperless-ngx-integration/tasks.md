# Implementation Plan

- [x] 1. Update database schema and run migrations
  - Add Paperless-ngx configuration fields to Settings model (paperlessUrl, paperlessApiToken, paperlessEnabled)
  - Add source tracking and Paperless-ngx specific fields to IndexedFile model (source, paperlessId, paperlessTitle, paperlessTags, paperlessCorrespondent)
  - Generate and run Prisma migration
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 2. Create Paperless-ngx API client module
  - [x] 2.1 Implement PaperlessClient class with connection testing
    - Create `lib/paperless.ts` file
    - Implement constructor with config validation
    - Implement `testConnection()` method to verify API connectivity
    - Add proper TypeScript interfaces for Paperless API responses
    - _Requirements: 1.5, 6.4_
  
  - [x] 2.2 Implement document fetching methods
    - Implement `getAllDocuments()` with pagination support
    - Implement `getDocument(id)` for single document retrieval
    - Implement `getDocumentContent(id)` to fetch text content
    - Add retry logic with exponential backoff for network errors
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 7.4_
  
  - [x] 2.3 Implement metadata resolution methods
    - Implement `getTagNames()` to resolve tag IDs to names
    - Implement `getCorrespondentName()` to resolve correspondent ID
    - Add caching for tag and correspondent lookups
    - _Requirements: 3.3_
  
  - [x] 2.4 Add error handling and validation
    - Handle authentication errors (401)
    - Handle not found errors (404)
    - Handle server errors (500)
    - Validate response data structure
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [x] 3. Extend Settings API for Paperless-ngx configuration
  - [x] 3.1 Update GET handler to return Paperless-ngx settings
    - Return paperlessUrl and paperlessEnabled status
    - Return boolean flag indicating if API token is configured (don't return actual token)
    - Handle case when settings don't exist
    - _Requirements: 1.2, 2.5_
  
  - [x] 3.2 Update POST handler to save Paperless-ngx configuration
    - Accept paperlessUrl, paperlessApiToken, and paperlessEnabled fields
    - Validate URL format before saving
    - Store configuration in database using Prisma
    - Return success/error response
    - _Requirements: 1.3, 1.4, 2.4_

- [x] 4. Extend Status API to include Paperless-ngx connection status
  - Update SystemStatus interface to include paperless status field
  - Check if Paperless-ngx is configured and enabled
  - Test connection using PaperlessClient when enabled
  - Count Paperless-ngx documents from database
  - Return appropriate status (connected/disconnected/not_configured/disabled)
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 5. Extend file processing for Paperless-ngx documents
  - Add `processPaperlessDocument()` function to `lib/files.ts`
  - Accept raw text content and Paperless metadata
  - Use existing chunking strategy (RecursiveCharacterTextSplitter)
  - Add Paperless-ngx specific metadata to each chunk
  - Return ProcessedChunk array compatible with existing indexer
  - _Requirements: 4.1_

- [x] 6. Extend indexer to support Paperless-ngx documents
  - [x] 6.1 Implement indexPaperlessDocument function
    - Generate unique filePath using format "paperless://{doc_id}"
    - Create hash from content and modified date
    - Check if document needs re-indexing by comparing hashes
    - Fetch document content via PaperlessClient
    - Process content into chunks using processPaperlessDocument
    - Generate embeddings for each chunk
    - Store chunks in Qdrant with Paperless-ngx metadata
    - Update IndexedFile record in SQLite with source="paperless"
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7_
  
  - [x] 6.2 Implement scanPaperlessDocuments function
    - Fetch Paperless-ngx configuration from database
    - Skip if not enabled
    - Create PaperlessClient instance
    - Fetch all documents from Paperless-ngx API
    - Index each document using indexPaperlessDocument
    - Handle errors gracefully (log and continue)
    - Identify deleted documents (in DB but not in Paperless-ngx)
    - Remove deleted documents from index
    - Return indexedCount and deletedCount
    - _Requirements: 3.1, 3.5, 4.6, 7.1, 7.2_
  
  - [x] 6.3 Update scanAllFiles to include Paperless-ngx
    - Call existing local file scan logic
    - Call scanPaperlessDocuments
    - Run both scans (handle errors independently)
    - Return combined results with separate counts
    - _Requirements: 5.4_

- [x] 7. Update Status page UI for Paperless-ngx configuration
  - [x] 7.1 Add Paperless-ngx configuration card
    - Create new card section in Status page
    - Add connection status badge display
    - Add input field for Paperless-ngx URL
    - Add password input field for API token
    - Add enable/disable toggle switch
    - Style consistently with existing cards
    - _Requirements: 1.1, 1.2_
  
  - [x] 7.2 Implement configuration form logic
    - Load Paperless-ngx settings on component mount
    - Handle form input changes
    - Implement "Test Connection" button functionality
    - Implement "Save Settings" button with validation
    - Show success/error messages after save
    - Display connection status updates
    - _Requirements: 1.3, 1.4, 1.5, 1.6_
  
  - [x] 7.3 Add Paperless-ngx connection status display
    - Display connection status in Connections card
    - Show document count if connected
    - Update status on page refresh
    - Handle different status states (connected/disconnected/not configured/disabled)
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6_

- [x] 8. Update Files page UI for Paperless-ngx documents
  - [x] 8.1 Update file list to display Paperless-ngx documents
    - Add "Source" column to the table
    - Display visual indicator (icon/badge) for Paperless-ngx documents
    - Show Paperless-ngx metadata (tags, correspondent) in table or tooltip
    - Update file path display for Paperless-ngx documents
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [x] 8.2 Update scan functionality
    - Ensure "Scan Now" button triggers both local and Paperless-ngx scans
    - Show progress/status during scan
    - Update file list after scan completes
    - _Requirements: 5.4_
  
  - [x] 8.3 Implement Paperless-ngx document actions
    - Add link to open document in Paperless-ngx (new tab)
    - Update delete behavior to only remove from index (not from Paperless-ngx)
    - Show appropriate confirmation message for Paperless-ngx document deletion
    - Disable re-index button for Paperless-ngx documents (handled by scan)
    - _Requirements: 5.5, 5.6_

- [x] 9. Update Files API to handle Paperless-ngx documents
  - [x] 9.1 Update GET handler
    - Return both local and Paperless-ngx documents
    - Include source field in response
    - Include Paperless-ngx specific fields when source is "paperless"
    - Check if files need re-indexing (for local files only)
    - _Requirements: 5.1_
  
  - [x] 9.2 Update DELETE handler
    - Check source field before deletion
    - If source is "paperless", only remove from index
    - If source is "local", remove from index and optionally from disk
    - Return appropriate success message
    - _Requirements: 5.6_

- [x] 10. Add error handling and user feedback
  - Implement error logging for Paperless-ngx operations
  - Add user-friendly error messages in UI
  - Handle network timeouts gracefully
  - Display actionable error messages for common issues (invalid token, unreachable server)
  - Add loading states for async operations
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ]* 11. Integration testing and validation
  - Test complete flow: configure → scan → index → search
  - Verify Paperless-ngx documents appear in Files page
  - Verify documents are searchable in chat interface
  - Test error scenarios (invalid credentials, unreachable server)
  - Test document deletion (index only)
  - Verify connection status updates correctly
  - _Requirements: All_
