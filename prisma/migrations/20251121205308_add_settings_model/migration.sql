-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "embeddingModel" TEXT NOT NULL,
    "chatModel" TEXT NOT NULL,
    "embeddingModelDimension" INTEGER NOT NULL DEFAULT 1024,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
