-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "chunkType" TEXT;

-- AlterTable
ALTER TABLE "IndexedFile" ADD COLUMN     "customOcrStatus" TEXT,
ADD COLUMN     "documentSummary" TEXT,
ADD COLUMN     "extractedDate" TIMESTAMP(3),
ADD COLUMN     "extractedTags" TEXT,
ADD COLUMN     "ocrOutputPath" TEXT,
ADD COLUMN     "originalDocPath" TEXT,
ADD COLUMN     "sourceOverride" TEXT,
ADD COLUMN     "useCustomOcr" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "customOcrEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visionModel" TEXT;

-- CreateIndex
CREATE INDEX "DocumentChunk_chunkType_idx" ON "DocumentChunk"("chunkType");

-- CreateIndex
CREATE INDEX "IndexedFile_useCustomOcr_idx" ON "IndexedFile"("useCustomOcr");

-- CreateIndex
CREATE INDEX "IndexedFile_sourceOverride_idx" ON "IndexedFile"("sourceOverride");
