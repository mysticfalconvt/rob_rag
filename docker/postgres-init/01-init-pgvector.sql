-- Initialize pgvector extension for RobRAG
-- This script runs automatically when the Postgres container starts for the first time

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify installation
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- Log success
DO $$
BEGIN
  RAISE NOTICE 'pgvector extension initialized successfully';
END $$;
