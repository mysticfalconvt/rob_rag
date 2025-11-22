-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IndexedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "lastModified" DATETIME NOT NULL,
    "lastIndexed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chunkCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'indexed',
    "source" TEXT NOT NULL DEFAULT 'local',
    "paperlessId" INTEGER,
    "paperlessTitle" TEXT,
    "paperlessTags" TEXT,
    "paperlessCorrespondent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_IndexedFile" ("chunkCount", "createdAt", "fileHash", "filePath", "id", "lastIndexed", "lastModified", "status", "updatedAt") SELECT "chunkCount", "createdAt", "fileHash", "filePath", "id", "lastIndexed", "lastModified", "status", "updatedAt" FROM "IndexedFile";
DROP TABLE "IndexedFile";
ALTER TABLE "new_IndexedFile" RENAME TO "IndexedFile";
CREATE UNIQUE INDEX "IndexedFile_filePath_key" ON "IndexedFile"("filePath");
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "embeddingModel" TEXT NOT NULL,
    "chatModel" TEXT NOT NULL,
    "embeddingModelDimension" INTEGER NOT NULL DEFAULT 1024,
    "paperlessUrl" TEXT,
    "paperlessApiToken" TEXT,
    "paperlessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("chatModel", "createdAt", "embeddingModel", "embeddingModelDimension", "id", "updatedAt") SELECT "chatModel", "createdAt", "embeddingModel", "embeddingModelDimension", "id", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
