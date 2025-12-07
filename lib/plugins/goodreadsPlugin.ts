import {
  DataSourcePlugin,
  DataSourceCapabilities,
  MetadataField,
  QueryParams,
  ToolDefinition,
  ScanResult,
} from "../dataSourceRegistry";
import { SearchResult } from "../retrieval";
import prisma from "../prisma";

/**
 * Goodreads data source plugin
 */
export class GoodreadsPlugin implements DataSourcePlugin {
  name = "goodreads";
  displayName = "Goodreads Books";

  capabilities: DataSourceCapabilities = {
    supportsMetadataQuery: true,
    supportsSemanticSearch: true,
    supportsScanning: true,
    requiresAuthentication: false, // Goodreads uses per-user RSS feeds
  };

  getMetadataSchema(): MetadataField[] {
    return [
      {
        name: "userRating",
        displayName: "User Rating",
        type: "number",
        queryable: true,
        filterable: true,
        description: "Rating given by the user (0-5 stars)",
      },
      {
        name: "dateRead",
        displayName: "Date Read",
        type: "date",
        queryable: true,
        filterable: true,
        description: "Most recent date the book was read",
      },
      {
        name: "readCount",
        displayName: "Read Count",
        type: "number",
        queryable: true,
        filterable: true,
        description: "Number of times the book has been read",
      },
      {
        name: "bookAuthor",
        displayName: "Author",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Book author name",
      },
      {
        name: "bookTitle",
        displayName: "Title",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Book title",
      },
      {
        name: "shelves",
        displayName: "Shelves",
        type: "array",
        queryable: true,
        filterable: true,
        description: "Goodreads shelves (pipe-separated in storage)",
      },
      {
        name: "userName",
        displayName: "User Name",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Name of the Goodreads user",
      },
      {
        name: "userId",
        displayName: "User ID",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Internal user ID",
      },
    ];
  }

  async queryByMetadata(params: QueryParams): Promise<SearchResult[]> {
    const limit = params.limit && params.limit > 0 ? params.limit : 500;

    try {
      // Build Prisma where clause
      const where: any = {
        source: this.name,
      };

      if (params.userId) {
        where.userId = params.userId;
      }

      if (params.minRating !== undefined || params.maxRating !== undefined) {
        where.userRating = {};
        if (params.minRating !== undefined) {
          where.userRating.gte = params.minRating;
        }
        if (params.maxRating !== undefined) {
          where.userRating.lte = params.maxRating;
        }
      }

      if (params.author) {
        where.bookAuthor = params.author;
      }

      if (params.startDate || params.endDate) {
        where.dateRead = {};
        if (params.startDate) {
          where.dateRead.gte = new Date(params.startDate).toISOString();
        }
        if (params.endDate) {
          where.dateRead.lte = new Date(params.endDate).toISOString();
        }
      }

      if (params.minReadCount !== undefined) {
        where.readCount = { gte: params.minReadCount };
      }

      if (params.shelf) {
        where.shelves = { contains: params.shelf };
      }

      // Query PostgreSQL
      const chunks = await prisma.documentChunk.findMany({
        where,
        take: limit,
        orderBy: { createdAt: "desc" },
      });

      return chunks.map((chunk) => ({
        content: chunk.content,
        metadata: {
          filePath: chunk.filePath,
          fileName: chunk.fileName,
          fileType: chunk.fileType || undefined,
          bookTitle: chunk.bookTitle || undefined,
          bookAuthor: chunk.bookAuthor || undefined,
          userRating: chunk.userRating || undefined,
          dateRead: chunk.dateRead || undefined,
          readDates: chunk.readDates || undefined,
          readCount: chunk.readCount || undefined,
          shelves: chunk.shelves || undefined,
          userId: chunk.userId || undefined,
          userName: chunk.userName || undefined,
        },
        score: 1.0, // Metadata query doesn't have similarity score
      }));
    } catch (error) {
      console.error("[GoodreadsPlugin] Error querying by metadata:", error);
      return [];
    }
  }

  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: "search_goodreads_by_rating",
        description:
          "Query the Goodreads database to get an ACCURATE count and list of books by rating. ALWAYS use this tool when the user asks 'how many' or wants to count books with a specific rating. This queries the database directly and returns ALL matching books (up to 100), not just the ones in the current context. Essential for counting queries.",
        parameters: [
          {
            name: "minRating",
            type: "number",
            required: false,
            description:
              "Minimum rating (1-5 stars). Use minRating=5 to find 5-star books.",
          },
          {
            name: "maxRating",
            type: "number",
            required: false,
            description:
              "Maximum rating (1-5 stars). Use maxRating=5 with minRating=5 to find exactly 5-star books.",
          },
          {
            name: "author",
            type: "string",
            required: false,
            description: "Filter by specific author name",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description:
              "Maximum number of results to return (default: 500). Should capture all books in most cases.",
          },
        ],
      },
      {
        name: "search_goodreads_by_date_read",
        description:
          "Search for books from Goodreads by the date they were read. Use this to count or find books read in a specific time period, or get reading history. Returns the total count and list of matching books.",
        parameters: [
          {
            name: "startDate",
            type: "string",
            required: false,
            description: "Start date in ISO format (YYYY-MM-DD)",
          },
          {
            name: "endDate",
            type: "string",
            required: false,
            description: "End date in ISO format (YYYY-MM-DD)",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description:
              "Maximum number of results to return (default: 500). Should capture all books in most cases.",
          },
        ],
      },
      {
        name: "search_goodreads_by_author",
        description:
          "Search for books from Goodreads by author name. Use this to count or find books by a specific author, optionally filtered by rating. Returns the total count and list of matching books.",
        parameters: [
          {
            name: "author",
            type: "string",
            required: true,
            description: "Author name to search for",
          },
          {
            name: "minRating",
            type: "number",
            required: false,
            description: "Minimum rating filter (1-5 stars)",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description:
              "Maximum number of results to return (default: 500). Should capture all books in most cases.",
          },
        ],
      },
    ];
  }

  async scan(options?: any): Promise<ScanResult> {
    try {
      const { indexGoodreadsBooks, parseGoodreadsRSS, importBooksForUser } =
        await import("../goodreads");

      let totalSynced = 0;
      let goodreadsCount = 0;

      const users = await prisma.goodreadsUser.findMany({
        include: {
          goodreadsSources: true,
          _count: {
            select: { goodreadsBooks: true },
          },
        },
      });

      console.log(`[GoodreadsPlugin] Found ${users.length} users to process`);

      // Step 1: Sync RSS feeds for users that have them configured
      for (const user of users) {
        if (user.goodreadsSources) {
          const source = user.goodreadsSources;
          try {
            console.log(`[GoodreadsPlugin] Syncing RSS feed for ${user.name}`);
            const response = await fetch(source.rssFeedUrl);
            if (response.ok) {
              const rssContent = await response.text();
              const books = await parseGoodreadsRSS(rssContent);
              const syncResult = await importBooksForUser(user.id, books);
              totalSynced += syncResult.created + syncResult.updated;
              console.log(
                `[GoodreadsPlugin] Synced ${books.length} books for ${user.name} (${syncResult.created} new, ${syncResult.updated} updated)`,
              );

              // Update last synced time
              await prisma.goodreadsSource.update({
                where: { id: source.id },
                data: { lastSyncedAt: new Date() },
              });
            } else {
              console.warn(
                `[GoodreadsPlugin] Failed to fetch RSS feed for ${user.name}: ${response.status}`,
              );
            }
          } catch (error) {
            console.error(
              `[GoodreadsPlugin] Error syncing RSS for ${user.name}:`,
              error,
            );
          }
        }
      }

      // Step 2: Re-fetch users with updated book counts
      const updatedUsers = await prisma.goodreadsUser.findMany({
        include: {
          _count: {
            select: { goodreadsBooks: true },
          },
        },
      });

      // Step 3: Index all books
      for (const user of updatedUsers) {
        console.log(
          `[GoodreadsPlugin] Indexing ${user._count.goodreadsBooks} books for ${user.name}`,
        );
        const count = await indexGoodreadsBooks(user.id);
        goodreadsCount += count;
        console.log(`✅ Indexed ${count} books for ${user.name}`);
      }

      return {
        indexed: goodreadsCount,
        updated: totalSynced,
        deleted: 0,
      };
    } catch (error) {
      console.error("[GoodreadsPlugin] Error during scan:", error);
      return {
        indexed: 0,
        deleted: 0,
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  }

  async isConfigured(): Promise<boolean> {
    try {
      const userCount = await prisma.goodreadsUser.count();
      return userCount > 0;
    } catch (error) {
      console.error("[GoodreadsPlugin] Error checking configuration:", error);
      return false;
    }
  }
}

// Export singleton instance
export const goodreadsPlugin = new GoodreadsPlugin();
