-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "calendarName" TEXT,
ADD COLUMN     "eventAttendees" TEXT,
ADD COLUMN     "eventEndTime" TEXT,
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "eventLocation" TEXT,
ADD COLUMN     "eventStartTime" TEXT,
ADD COLUMN     "eventTitle" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "googleAccessToken" TEXT,
ADD COLUMN     "googleCalendarIds" TEXT,
ADD COLUMN     "googleClientId" TEXT,
ADD COLUMN     "googleClientSecret" TEXT,
ADD COLUMN     "googleLastSynced" TIMESTAMP(3),
ADD COLUMN     "googleRefreshToken" TEXT,
ADD COLUMN     "googleSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "googleTokenExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "calendarName" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "attendees" TEXT,
    "recurringEventId" TEXT,
    "htmlLink" TEXT,
    "embedding" vector,
    "embeddingVersion" INTEGER DEFAULT 1,
    "lastEmbedded" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_eventId_key" ON "CalendarEvent"("eventId");

-- CreateIndex
CREATE INDEX "CalendarEvent_eventId_idx" ON "CalendarEvent"("eventId");

-- CreateIndex
CREATE INDEX "CalendarEvent_calendarId_idx" ON "CalendarEvent"("calendarId");

-- CreateIndex
CREATE INDEX "CalendarEvent_startTime_idx" ON "CalendarEvent"("startTime");

-- CreateIndex
CREATE INDEX "CalendarEvent_endTime_idx" ON "CalendarEvent"("endTime");

-- CreateIndex
CREATE INDEX "CalendarEvent_embedding_idx" ON "CalendarEvent"("embedding");

-- CreateIndex
CREATE INDEX "DocumentChunk_eventId_idx" ON "DocumentChunk"("eventId");

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
