-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userName" TEXT,
    "userBio" TEXT,
    "userPreferences" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "AuthUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexedFile" (
    "id" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "lastModified" TIMESTAMP(3) NOT NULL,
    "lastIndexed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chunkCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'indexed',
    "source" TEXT NOT NULL DEFAULT 'local',
    "uploadedBy" TEXT,
    "paperlessId" INTEGER,
    "paperlessTitle" TEXT,
    "paperlessTags" TEXT,
    "paperlessCorrespondent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topics" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sources" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "embeddingModel" TEXT NOT NULL,
    "chatModel" TEXT NOT NULL,
    "fastChatModel" TEXT,
    "embeddingModelDimension" INTEGER NOT NULL DEFAULT 1024,
    "paperlessUrl" TEXT,
    "paperlessExternalUrl" TEXT,
    "paperlessApiToken" TEXT,
    "paperlessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ragSystemPrompt" TEXT,
    "noSourcesSystemPrompt" TEXT,
    "titleGenerationPrompt" TEXT,
    "maxContextTokens" INTEGER NOT NULL DEFAULT 8000,
    "contextStrategy" TEXT NOT NULL DEFAULT 'smart',
    "slidingWindowSize" INTEGER NOT NULL DEFAULT 10,
    "enableContextSummary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodreadsUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodreadsUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodreadsSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rssFeedUrl" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodreadsSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodreadsBook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goodreadsBookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "additionalAuthors" TEXT,
    "isbn" TEXT,
    "isbn13" TEXT,
    "userRating" INTEGER,
    "averageRating" DOUBLE PRECISION,
    "dateRead" TIMESTAMP(3),
    "readDates" TEXT,
    "dateAdded" TIMESTAMP(3),
    "shelves" TEXT,
    "reviewText" TEXT,
    "spoiler" BOOLEAN NOT NULL DEFAULT false,
    "privateNotes" TEXT,
    "pages" INTEGER,
    "yearPublished" INTEGER,
    "readCount" INTEGER NOT NULL DEFAULT 1,
    "imageUrl" TEXT,
    "embedding" vector(1024),
    "embeddingVersion" INTEGER DEFAULT 1,
    "lastEmbedded" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodreadsBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT,
    "fileId" TEXT,
    "bookId" TEXT,
    "chunkIndex" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "bookTitle" TEXT,
    "bookAuthor" TEXT,
    "userRating" INTEGER,
    "dateRead" TEXT,
    "readDates" TEXT,
    "readCount" INTEGER,
    "shelves" TEXT,
    "paperlessId" INTEGER,
    "paperlessTitle" TEXT,
    "paperlessTags" TEXT,
    "paperlessCorrespondent" TEXT,
    "documentDate" TEXT,
    "embeddingVersion" INTEGER NOT NULL DEFAULT 1,
    "lastEmbedded" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_email_key" ON "AuthUser"("email");

-- CreateIndex
CREATE INDEX "AuthUser_email_idx" ON "AuthUser"("email");

-- CreateIndex
CREATE INDEX "AuthUser_role_idx" ON "AuthUser"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IndexedFile_filePath_key" ON "IndexedFile"("filePath");

-- CreateIndex
CREATE INDEX "IndexedFile_uploadedBy_idx" ON "IndexedFile"("uploadedBy");

-- CreateIndex
CREATE INDEX "IndexedFile_source_idx" ON "IndexedFile"("source");

-- CreateIndex
CREATE INDEX "IndexedFile_filePath_idx" ON "IndexedFile"("filePath");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "Conversation_createdAt_idx" ON "Conversation"("createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodreadsUser_email_key" ON "GoodreadsUser"("email");

-- CreateIndex
CREATE INDEX "GoodreadsUser_email_idx" ON "GoodreadsUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "GoodreadsSource_userId_key" ON "GoodreadsSource"("userId");

-- CreateIndex
CREATE INDEX "GoodreadsSource_userId_idx" ON "GoodreadsSource"("userId");

-- CreateIndex
CREATE INDEX "GoodreadsBook_userId_idx" ON "GoodreadsBook"("userId");

-- CreateIndex
CREATE INDEX "GoodreadsBook_goodreadsBookId_idx" ON "GoodreadsBook"("goodreadsBookId");

-- CreateIndex
CREATE INDEX "GoodreadsBook_userRating_idx" ON "GoodreadsBook"("userRating");

-- CreateIndex
CREATE INDEX "GoodreadsBook_dateRead_idx" ON "GoodreadsBook"("dateRead");

-- CreateIndex
CREATE UNIQUE INDEX "GoodreadsBook_userId_goodreadsBookId_key" ON "GoodreadsBook"("userId", "goodreadsBookId");

-- CreateIndex
CREATE INDEX "DocumentChunk_source_idx" ON "DocumentChunk"("source");

-- CreateIndex
CREATE INDEX "DocumentChunk_filePath_idx" ON "DocumentChunk"("filePath");

-- CreateIndex
CREATE INDEX "DocumentChunk_fileId_idx" ON "DocumentChunk"("fileId");

-- CreateIndex
CREATE INDEX "DocumentChunk_bookId_idx" ON "DocumentChunk"("bookId");

-- CreateIndex
CREATE INDEX "DocumentChunk_userId_idx" ON "DocumentChunk"("userId");

-- CreateIndex
CREATE INDEX "DocumentChunk_userRating_idx" ON "DocumentChunk"("userRating");

-- CreateIndex
CREATE INDEX "DocumentChunk_dateRead_idx" ON "DocumentChunk"("dateRead");

-- CreateIndex
CREATE INDEX "DocumentChunk_paperlessId_idx" ON "DocumentChunk"("paperlessId");

-- Create HNSW index for vector similarity search on DocumentChunk
CREATE INDEX "DocumentChunk_embedding_idx" ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);

-- Create HNSW index for vector similarity search on GoodreadsBook (optional embedding)
CREATE INDEX "GoodreadsBook_embedding_idx" ON "GoodreadsBook" USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexedFile" ADD CONSTRAINT "IndexedFile_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "AuthUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodreadsSource" ADD CONSTRAINT "GoodreadsSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "GoodreadsUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodreadsBook" ADD CONSTRAINT "GoodreadsBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "GoodreadsUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "IndexedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "GoodreadsBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
