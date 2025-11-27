import {
  DataSourcePlugin,
  DataSourceCapabilities,
  MetadataField,
  QueryParams,
  ToolDefinition,
  ScanResult,
} from "../dataSourceRegistry";
import { SearchResult } from "../retrieval";
import { createQueryBuilder } from "../queryBuilder";
import { config } from "../config";
import { COLLECTION_NAME } from "../qdrant";
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
    const builder = createQueryBuilder().source(this.name);

    // Handle userId if provided
    if (params.userId) {
      builder.userId(params.userId);
    }

    // Rating filters
    if (params.minRating !== undefined) {
      builder.greaterThanOrEqual("userRating", params.minRating);
    }
    if (params.maxRating !== undefined) {
      builder.lessThanOrEqual("userRating", params.maxRating);
    }

    // Author filter
    if (params.author) {
      builder.equals("bookAuthor", params.author);
    }

    // Date range filters
    if (params.startDate && params.endDate) {
      builder.dateRange(
        "dateRead",
        new Date(params.startDate),
        new Date(params.endDate),
      );
    } else if (params.startDate) {
      builder.greaterThanOrEqual(
        "dateRead",
        new Date(params.startDate).toISOString(),
      );
    } else if (params.endDate) {
      builder.lessThanOrEqual(
        "dateRead",
        new Date(params.endDate).toISOString(),
      );
    }

    // Read count filter
    if (params.minReadCount !== undefined) {
      builder.greaterThanOrEqual("readCount", params.minReadCount);
    }

    // Shelf filter (would need to check if shelf string contains the value)
    // Note: This is limited by Qdrant's string matching capabilities
    if (params.shelf) {
      builder.equals("shelves", params.shelf);
    }

    const filter = builder.build();

    // Query Qdrant with the built filter
    // Use very high default limit (500) to capture all items for accurate counting
    // Treat 0 or undefined as unspecified (use default)
    const limit = params.limit && params.limit > 0 ? params.limit : 500;

    try {
      const response = await fetch(
        `${config.QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filter,
            limit,
            with_payload: true,
            with_vector: false,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Qdrant query failed: ${response.statusText}`);
      }

      const data = await response.json();
      const points = Array.isArray(data.result?.points)
        ? data.result.points
        : [];

      return points.map((p: any) => ({
        content: p.payload?.content as string,
        metadata: {
          filePath: p.payload?.filePath,
          fileName: p.payload?.fileName,
          fileType: p.payload?.fileType,
          ...p.payload,
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
        if (user.goodreadsSources.length > 0) {
          const source = user.goodreadsSources[0];
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
