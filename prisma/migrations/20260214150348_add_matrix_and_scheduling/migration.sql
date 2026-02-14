-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "goodreadsSyncSchedule" TEXT DEFAULT '0 2 * * *',
ADD COLUMN     "googleCalendarSyncSchedule" TEXT DEFAULT '0 0 * * *',
ADD COLUMN     "matrixAccessToken" TEXT,
ADD COLUMN     "matrixEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "matrixHomeserver" TEXT,
ADD COLUMN     "matrixUserId" TEXT,
ADD COLUMN     "paperlessSyncSchedule" TEXT DEFAULT '0 * * * *';

-- CreateTable
CREATE TABLE "MatrixRoom" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatrixRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "query" TEXT,
    "matrixRoomId" TEXT,
    "syncSource" TEXT,
    "lastRun" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastRunError" TEXT,
    "nextRun" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskExecution" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "error" TEXT,
    "response" TEXT,
    "metadata" TEXT,

    CONSTRAINT "TaskExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatrixRoom_roomId_key" ON "MatrixRoom"("roomId");

-- CreateIndex
CREATE INDEX "MatrixRoom_enabled_idx" ON "MatrixRoom"("enabled");

-- CreateIndex
CREATE INDEX "MatrixRoom_roomId_idx" ON "MatrixRoom"("roomId");

-- CreateIndex
CREATE INDEX "ScheduledTask_enabled_nextRun_idx" ON "ScheduledTask"("enabled", "nextRun");

-- CreateIndex
CREATE INDEX "ScheduledTask_type_idx" ON "ScheduledTask"("type");

-- CreateIndex
CREATE INDEX "ScheduledTask_syncSource_idx" ON "ScheduledTask"("syncSource");

-- CreateIndex
CREATE INDEX "TaskExecution_taskId_startedAt_idx" ON "TaskExecution"("taskId", "startedAt");

-- CreateIndex
CREATE INDEX "TaskExecution_status_idx" ON "TaskExecution"("status");

-- CreateIndex
CREATE INDEX "TaskExecution_startedAt_idx" ON "TaskExecution"("startedAt");

-- AddForeignKey
ALTER TABLE "TaskExecution" ADD CONSTRAINT "TaskExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ScheduledTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
