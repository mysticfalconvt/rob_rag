-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GoodreadsSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "rssFeedUrl" TEXT NOT NULL,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoodreadsSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoodreadsBook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goodreadsBookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "additionalAuthors" TEXT,
    "isbn" TEXT,
    "isbn13" TEXT,
    "userRating" INTEGER,
    "averageRating" REAL,
    "dateRead" DATETIME,
    "dateAdded" DATETIME,
    "shelves" TEXT,
    "reviewText" TEXT,
    "spoiler" BOOLEAN NOT NULL DEFAULT false,
    "privateNotes" TEXT,
    "pages" INTEGER,
    "yearPublished" INTEGER,
    "readCount" INTEGER NOT NULL DEFAULT 1,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoodreadsBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "GoodreadsSource_userId_idx" ON "GoodreadsSource"("userId");

-- CreateIndex
CREATE INDEX "GoodreadsBook_userId_idx" ON "GoodreadsBook"("userId");

-- CreateIndex
CREATE INDEX "GoodreadsBook_goodreadsBookId_idx" ON "GoodreadsBook"("goodreadsBookId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodreadsBook_userId_goodreadsBookId_key" ON "GoodreadsBook"("userId", "goodreadsBookId");
