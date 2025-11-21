-- CreateTable
CREATE TABLE "IndexedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "lastModified" DATETIME NOT NULL,
    "lastIndexed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chunkCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'indexed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "IndexedFile_filePath_key" ON "IndexedFile"("filePath");
