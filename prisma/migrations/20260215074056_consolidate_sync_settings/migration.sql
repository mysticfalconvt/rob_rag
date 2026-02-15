-- AlterTable: Remove old sync-related columns and add unified daily sync fields
ALTER TABLE "Settings" DROP COLUMN IF EXISTS "paperlessSyncEnabled",
DROP COLUMN IF EXISTS "paperlessSyncInterval",
DROP COLUMN IF EXISTS "paperlessSyncLastRun",
DROP COLUMN IF EXISTS "paperlessSyncFilters",
DROP COLUMN IF EXISTS "paperlessAutoOcr",
DROP COLUMN IF EXISTS "googleCalendarSyncSchedule",
DROP COLUMN IF EXISTS "paperlessSyncSchedule",
DROP COLUMN IF EXISTS "goodreadsSyncSchedule",
ADD COLUMN "dailySyncTime" TEXT DEFAULT '03:00',
ADD COLUMN "dailySyncLastRun" TIMESTAMP(3),
ADD COLUMN "dailySyncLastStatus" TEXT,
ADD COLUMN "dailySyncLastError" TEXT;
