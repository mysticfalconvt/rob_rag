-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "paperlessAutoOcr" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paperlessSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paperlessSyncFilters" TEXT,
ADD COLUMN     "paperlessSyncInterval" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "paperlessSyncLastRun" TIMESTAMP(3),
ADD COLUMN     "syncedFilesConfig" TEXT;

-- CreateTable
CREATE TABLE "OcrJob" (
    "id" TEXT NOT NULL,
    "paperlessId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "visionModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcrJob_paperlessId_idx" ON "OcrJob"("paperlessId");

-- CreateIndex
CREATE INDEX "OcrJob_status_idx" ON "OcrJob"("status");

-- CreateIndex
CREATE INDEX "OcrJob_createdAt_idx" ON "OcrJob"("createdAt");
