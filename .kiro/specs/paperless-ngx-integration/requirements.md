# Requirements Document

## Introduction

This feature adds integration with Paperless-ngx, a document management system, to the RAG application. Users will be able to configure their Paperless-ngx instance connection details through the Status page, and the system will automatically fetch and index documents from Paperless-ngx alongside local files. This enables users to search and query their Paperless-ngx documents through the RAG chat interface.

Paperless-ngx provides a REST API that allows fetching documents and their metadata. The integration will treat Paperless-ngx documents as an additional document source, similar to how local files are currently handled.

## Requirements

### Requirement 1: Paperless-ngx Configuration Management

**User Story:** As a user, I want to configure my Paperless-ngx connection details in the Status page, so that the system can connect to my Paperless-ngx instance.

#### Acceptance Criteria

1. WHEN the user navigates to the Status page THEN the system SHALL display a new "Paperless-ngx Configuration" section
2. WHEN the user views the configuration section THEN the system SHALL display input fields for:
   - Paperless-ngx URL (e.g., http://localhost:8000)
   - API Token
   - Enable/Disable toggle
3. WHEN the user enters configuration details and clicks "Save" THEN the system SHALL validate the URL format
4. WHEN the user saves valid configuration THEN the system SHALL store the settings in the SQLite database
5. WHEN the user saves configuration THEN the system SHALL test the connection to Paperless-ngx and display connection status
6. IF the connection test fails THEN the system SHALL display an error message with details
7. WHEN the user disables Paperless-ngx integration THEN the system SHALL not fetch documents from Paperless-ngx during scans

### Requirement 2: Database Schema Extension

**User Story:** As a developer, I want the database schema to support Paperless-ngx configuration storage, so that connection details persist across application restarts.

#### Acceptance Criteria

1. WHEN the Prisma schema is updated THEN the system SHALL include a new field in the Settings model for Paperless-ngx URL
2. WHEN the Prisma schema is updated THEN the system SHALL include a new field in the Settings model for Paperless-ngx API token
3. WHEN the Prisma schema is updated THEN the system SHALL include a new field in the Settings model for Paperless-ngx enabled status
4. WHEN the database migration runs THEN the system SHALL create the new fields without data loss
5. WHEN Paperless-ngx settings are not configured THEN the system SHALL return null or default values

### Requirement 3: Paperless-ngx Document Fetching

**User Story:** As a user, I want the system to automatically fetch documents from my Paperless-ngx instance, so that I can search them through the RAG interface.

#### Acceptance Criteria

1. WHEN the user triggers a scan (manual or automatic) AND Paperless-ngx is enabled THEN the system SHALL fetch the list of documents from the Paperless-ngx API
2. WHEN fetching documents THEN the system SHALL use the configured API token for authentication
3. WHEN fetching documents THEN the system SHALL retrieve document metadata including:
   - Document ID
   - Title
   - Content (text)
   - Created date
   - Modified date
   - Tags
   - Correspondent
4. WHEN a document is fetched THEN the system SHALL download the document content via the Paperless-ngx API
5. IF the Paperless-ngx API returns an error THEN the system SHALL log the error and continue with other documents
6. WHEN fetching documents THEN the system SHALL handle pagination if the Paperless-ngx instance has many documents

### Requirement 4: Paperless-ngx Document Indexing

**User Story:** As a user, I want Paperless-ngx documents to be indexed and searchable, so that I can query them alongside my local files.

#### Acceptance Criteria

1. WHEN a Paperless-ngx document is fetched THEN the system SHALL process it into chunks using the same chunking strategy as local files
2. WHEN processing Paperless-ngx documents THEN the system SHALL generate embeddings for each chunk
3. WHEN storing chunks in Qdrant THEN the system SHALL include metadata indicating the source is Paperless-ngx
4. WHEN storing chunks THEN the system SHALL include Paperless-ngx specific metadata (document ID, tags, correspondent)
5. WHEN a Paperless-ngx document is updated THEN the system SHALL detect the change and re-index the document
6. WHEN a Paperless-ngx document is deleted THEN the system SHALL remove it from the index during the next scan
7. WHEN storing in SQLite THEN the system SHALL use a unique identifier that distinguishes Paperless-ngx documents from local files

### Requirement 5: Files Page Integration

**User Story:** As a user, I want to see Paperless-ngx documents listed on the Files page, so that I can monitor which documents are indexed.

#### Acceptance Criteria

1. WHEN the user views the Files page THEN the system SHALL display both local files and Paperless-ngx documents
2. WHEN displaying a Paperless-ngx document THEN the system SHALL show a visual indicator (badge or icon) that it's from Paperless-ngx
3. WHEN displaying a Paperless-ngx document THEN the system SHALL show relevant metadata (title, tags, correspondent)
4. WHEN the user clicks "Scan Now" THEN the system SHALL scan both local files and Paperless-ngx documents
5. WHEN the user clicks on a Paperless-ngx document THEN the system SHALL display the document details
6. WHEN the user deletes a Paperless-ngx document from the Files page THEN the system SHALL only remove it from the index (not delete from Paperless-ngx)

### Requirement 6: Connection Status Monitoring

**User Story:** As a user, I want to see the connection status of my Paperless-ngx instance on the Status page, so that I know if the integration is working correctly.

#### Acceptance Criteria

1. WHEN the user views the Status page THEN the system SHALL display the Paperless-ngx connection status (connected/disconnected)
2. WHEN Paperless-ngx is not configured THEN the system SHALL display "Not Configured" status
3. WHEN Paperless-ngx is disabled THEN the system SHALL display "Disabled" status
4. WHEN the connection status is checked THEN the system SHALL make a test API call to Paperless-ngx
5. IF the test API call fails THEN the system SHALL display "Disconnected" with error details
6. WHEN the Status page refreshes THEN the system SHALL update the Paperless-ngx connection status

### Requirement 7: Error Handling and Resilience

**User Story:** As a user, I want the system to handle Paperless-ngx errors gracefully, so that issues with Paperless-ngx don't break the entire RAG application.

#### Acceptance Criteria

1. WHEN Paperless-ngx is unreachable during a scan THEN the system SHALL log the error and continue scanning local files
2. WHEN a Paperless-ngx document fails to download THEN the system SHALL log the error and continue with other documents
3. WHEN the API token is invalid THEN the system SHALL display a clear error message to the user
4. WHEN network errors occur THEN the system SHALL implement retry logic with exponential backoff
5. WHEN Paperless-ngx returns malformed data THEN the system SHALL handle the error gracefully and skip the problematic document
6. WHEN errors occur THEN the system SHALL provide actionable error messages to help users troubleshoot
