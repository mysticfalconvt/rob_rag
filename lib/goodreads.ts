import Papa from "papaparse";
import { parseStringPromise } from "xml2js";
import prisma from "./prisma";

export interface CSVBookRow {
  "Book Id": string;
  Title: string;
  Author: string;
  "Author l-f": string;
  "Additional Authors": string;
  ISBN: string;
  ISBN13: string;
  "My Rating": string;
  "Average Rating": string;
  Publisher: string;
  Binding: string;
  "Number of Pages": string;
  "Year Published": string;
  "Original Publication Year": string;
  "Date Read": string;
  "Date Added": string;
  Bookshelves: string;
  "Bookshelves with positions": string;
  "Exclusive Shelf": string;
  "My Review": string;
  Spoiler: string;
  "Private Notes": string;
  "Read Count": string;
  "Owned Copies": string;
}

export interface ParsedBook {
  goodreadsBookId: string;
  title: string;
  author: string;
  additionalAuthors?: string;
  isbn?: string;
  isbn13?: string;
  userRating?: number;
  averageRating?: number;
  dateRead?: Date;
  readDates?: string; // JSON array of ISO date strings
  dateAdded?: Date;
  shelves?: string;
  reviewText?: string;
  spoiler: boolean;
  privateNotes?: string;
  pages?: number;
  yearPublished?: number;
  readCount: number;
}

/**
 * Parse Goodreads CSV export file
 */
export function parseGoodreadsCSV(csvContent: string): ParsedBook[] {
  const result = Papa.parse<CSVBookRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    console.error("CSV parsing errors:", result.errors);
  }

  return result.data.map((row) => {
    const book: ParsedBook = {
      goodreadsBookId: row["Book Id"],
      title: row.Title,
      author: row.Author,
      additionalAuthors: row["Additional Authors"] || undefined,
      isbn: cleanISBN(row.ISBN),
      isbn13: cleanISBN(row.ISBN13),
      userRating: parseRating(row["My Rating"]),
      averageRating: parseFloat(row["Average Rating"]) || undefined,
      dateRead: parseDate(row["Date Read"]),
      dateAdded: parseDate(row["Date Added"]),
      shelves: parseShelves(row.Bookshelves, row["Exclusive Shelf"]),
      reviewText: row["My Review"] || undefined,
      spoiler: row.Spoiler === "true",
      privateNotes: row["Private Notes"] || undefined,
      pages: parseInt(row["Number of Pages"]) || undefined,
      yearPublished: parseInt(row["Year Published"]) || undefined,
      readCount: parseInt(row["Read Count"]) || 1,
    };
    return book;
  });
}

/**
 * Parse Goodreads RSS feed
 */
export async function parseGoodreadsRSS(
  rssContent: string,
): Promise<ParsedBook[]> {
  const result = await parseStringPromise(rssContent);
  const items = result.rss?.channel?.[0]?.item || [];

  return items.map((item: any) => {
    const userRating = parseInt(item.user_rating?.[0]) || undefined;
    const averageRating = parseFloat(item.average_rating?.[0]) || undefined;
    const dateRead = parseDate(item.user_read_at?.[0]);
    const dateAdded = parseDate(item.user_date_created?.[0]);
    const bookId = extractBookIdFromLink(item.book_id?.[0] || item.link?.[0]);

    // Parse shelves from RSS (comma-separated string)
    const shelvesString = item.user_shelves?.[0];
    let shelvesJson = undefined;
    if (shelvesString) {
      const shelvesArray = shelvesString
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      shelvesJson = JSON.stringify(shelvesArray);
    }

    const book: ParsedBook = {
      goodreadsBookId: bookId,
      title: item.title?.[0] || "",
      author: item.author_name?.[0] || "",
      isbn: item.isbn?.[0] || undefined,
      userRating,
      averageRating,
      dateRead,
      dateAdded,
      reviewText: stripHtml(item.description?.[0]) || undefined,
      pages: parseInt(item.book_published?.[0]) || undefined,
      shelves: shelvesJson,
      spoiler: false,
      readCount: 1,
    };
    return book;
  });
}

/**
 * Import books for a user from parsed data
 */
export async function importBooksForUser(
  userId: string,
  books: ParsedBook[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const book of books) {
    const existing = await prisma.goodreadsBook.findUnique({
      where: {
        userId_goodreadsBookId: {
          userId,
          goodreadsBookId: book.goodreadsBookId,
        },
      },
    });

    if (existing) {
      // Parse existing read dates
      let existingDates: string[] = [];
      if (existing.readDates) {
        try {
          existingDates = JSON.parse(existing.readDates);
        } catch (e) {
          console.error("Error parsing existing readDates:", e);
        }
      } else if (existing.dateRead) {
        // Migrate old single dateRead to array
        existingDates = [existing.dateRead.toISOString()];
      }

      // Check if this is a new read date
      const newDateStr = book.dateRead?.toISOString();
      const isNewRead = newDateStr && !existingDates.includes(newDateStr);

      let updatedDates = existingDates;
      let updatedReadCount = existing.readCount;

      if (isNewRead && newDateStr) {
        // Add new date and increment count
        updatedDates = [...existingDates, newDateStr].sort(); // Sort chronologically
        updatedReadCount = existing.readCount + 1;
      }

      const updateData = {
        ...book,
        readCount: updatedReadCount,
        dateRead: book.dateRead || existing.dateRead, // Keep most recent
        readDates: JSON.stringify(updatedDates),
      };

      await prisma.goodreadsBook.update({
        where: { id: existing.id },
        data: updateData,
      });
      updated++;
    } else {
      // New book - initialize readDates array
      const readDatesArray = book.dateRead ? [book.dateRead.toISOString()] : [];

      await prisma.goodreadsBook.create({
        data: {
          userId,
          ...book,
          readDates: JSON.stringify(readDatesArray),
        },
      });
      created++;
    }
  }

  return { created, updated };
}

/**
 * Index all books for a user into RAG system
 */
export async function indexGoodreadsBooks(userId: string): Promise<number> {
  const { v4: uuidv4 } = await import("uuid");
  const { generateEmbedding } = await import("./ai");
  const { config } = await import("./config");
  const { ensureCollection, COLLECTION_NAME, qdrantClient } = await import(
    "./qdrant"
  );

  // Get user with books
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      goodreadsBooks: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  // Delete old Goodreads points for this user
  await ensureCollection();
  await qdrantClient.delete(COLLECTION_NAME, {
    filter: {
      must: [
        {
          key: "source",
          match: { value: "goodreads" },
        },
        {
          key: "userId",
          match: { value: userId },
        },
      ],
    },
  });

  // Generate chunks and embeddings
  const points = [];
  for (const book of user.goodreadsBooks) {
    const chunkText = generateBookChunk(user.name, book);
    const embedding = await generateEmbedding(chunkText);

    const shelves = book.shelves ? JSON.parse(book.shelves) : [];
    const filePath = `goodreads://${userId}/${book.id}`;

    // Parse read dates for payload
    let readDates: string[] = [];
    if (book.readDates) {
      try {
        readDates = JSON.parse(book.readDates);
      } catch (e) {
        console.error("Error parsing readDates for indexing:", e);
      }
    }

    points.push({
      id: uuidv4(),
      vector: embedding,
      payload: {
        content: chunkText,
        source: "goodreads",
        filePath: filePath,
        fileName: book.title,
        fileType: "goodreads",
        userId: userId,
        userName: user.name,
        bookId: book.goodreadsBookId,
        bookTitle: book.title,
        bookAuthor: book.author,
        userRating: book.userRating || 0,
        dateRead: book.dateRead?.toISOString() || "", // Most recent read
        readDates: readDates.join("|"), // Convert array to delimited string
        readCount: book.readCount,
        shelves: shelves.join("|"), // Convert array to delimited string
      },
    });
  }

  // Upsert to Qdrant
  if (points.length > 0) {
    const response = await fetch(
      `${config.QDRANT_URL}/collections/${COLLECTION_NAME}/points?wait=true`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Qdrant upsert failed: ${response.status} ${response.statusText} - ${errText}`,
      );
    }
  }

  return points.length;
}

/**
 * Generate RAG document chunk for a book
 */
export function generateBookChunk(userName: string, book: any): string {
  const parts: string[] = [];

  // Basic info
  parts.push(`${userName} read "${book.title}" by ${book.author}`);

  // Reading dates - handle multiple reads
  let readDates: string[] = [];
  if (book.readDates) {
    try {
      readDates = JSON.parse(book.readDates);
    } catch (e) {
      // Fall back to single dateRead
      if (book.dateRead) {
        readDates = [new Date(book.dateRead).toISOString()];
      }
    }
  } else if (book.dateRead) {
    readDates = [new Date(book.dateRead).toISOString()];
  }

  if (readDates.length > 0) {
    if (readDates.length === 1) {
      const date = new Date(readDates[0]);
      const monthYear = date.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      parts.push(`in ${monthYear}`);
    } else {
      // Multiple reads
      const formattedDates = readDates.map((d) => {
        const date = new Date(d);
        return date.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });
      });
      parts.push(`${book.readCount} times (${formattedDates.join(", ")})`);
    }
  }

  // Rating
  if (book.userRating !== null && book.userRating > 0) {
    parts.push(`and rated it ${book.userRating} stars`);
  }

  let mainText = parts.join(" ") + ".";

  // Shelves
  if (book.shelves) {
    try {
      const shelves = JSON.parse(book.shelves);
      if (Array.isArray(shelves) && shelves.length > 0) {
        mainText += ` Shelved as: ${shelves.join(", ")}.`;
      }
    } catch (error) {
      // If shelves is not valid JSON, treat it as a comma-separated string
      const shelvesArray = book.shelves
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (shelvesArray.length > 0) {
        mainText += ` Shelved as: ${shelvesArray.join(", ")}.`;
      }
    }
  }

  // Review
  if (book.reviewText && book.reviewText.trim()) {
    mainText += ` Review: ${book.reviewText}`;
  }

  // Additional metadata
  const metadata: string[] = [];
  if (book.pages) metadata.push(`${book.pages} pages`);
  if (book.yearPublished) metadata.push(`published ${book.yearPublished}`);
  if (metadata.length > 0) {
    mainText += ` (${metadata.join(", ")})`;
  }

  return mainText;
}

// Helper functions

function cleanISBN(isbn: string): string | undefined {
  if (!isbn) return undefined;
  // Remove ="..." wrapping that Goodreads adds
  return isbn.replace(/^="?(.+?)"?$/, "$1") || undefined;
}

function parseRating(rating: string): number | undefined {
  const parsed = parseInt(rating);
  return parsed > 0 ? parsed : undefined;
}

function parseDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? undefined : date;
}

function parseShelves(bookshelves: string, exclusiveShelf: string): string {
  const shelves = new Set<string>();

  if (bookshelves) {
    bookshelves.split(",").forEach((shelf) => shelves.add(shelf.trim()));
  }

  if (exclusiveShelf) {
    shelves.add(exclusiveShelf.trim());
  }

  return JSON.stringify(Array.from(shelves).filter((s) => s));
}

function extractBookIdFromLink(link: string): string {
  // Extract book ID from Goodreads URL or return as-is if already an ID
  const match = link?.match(/\/book\/show\/(\d+)/);
  return match ? match[1] : link || "";
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}
