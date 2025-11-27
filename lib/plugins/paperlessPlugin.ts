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
import { getPaperlessClient } from "../paperless";

/**
 * Paperless-ngx data source plugin
 */
export class PaperlessPlugin implements DataSourcePlugin {
  name = "paperless";
  displayName = "Paperless Documents";

  capabilities: DataSourceCapabilities = {
    supportsMetadataQuery: true,
    supportsSemanticSearch: true,
    supportsScanning: true,
    requiresAuthentication: true, // Requires Paperless URL and API token
  };

  getMetadataSchema(): MetadataField[] {
    return [
      {
        name: "documentId",
        displayName: "Document ID",
        type: "number",
        queryable: true,
        filterable: true,
        description: "Paperless document ID",
      },
      {
        name: "tags",
        displayName: "Tags",
        type: "array",
        queryable: true,
        filterable: true,
        description: "Document tags (pipe-separated in storage)",
      },
      {
        name: "correspondent",
        displayName: "Correspondent",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Document correspondent/sender",
      },
      {
        name: "documentDate",
        displayName: "Document Date",
        type: "date",
        queryable: true,
        filterable: true,
        description: "Date of the document",
      },
      {
        name: "addedDate",
        displayName: "Added Date",
        type: "date",
        queryable: true,
        filterable: true,
        description: "Date document was added to Paperless",
      },
      {
        name: "modifiedDate",
        displayName: "Modified Date",
        type: "date",
        queryable: true,
        filterable: true,
        description: "Date document was last modified",
      },
    ];
  }

  async queryByMetadata(params: QueryParams): Promise<SearchResult[]> {
    const builder = createQueryBuilder().source(this.name);

    // Document ID filter
    if (params.documentId !== undefined) {
      builder.equals("documentId", params.documentId);
    }

    // Correspondent filter
    if (params.correspondent) {
      builder.equals("correspondent", params.correspondent);
    }

    // Tags filter - we'll do case-insensitive contains matching after fetching results
    // Don't add to Qdrant filter since tags are stored as pipe-separated strings
    // and we want case-insensitive partial matching

    // Document date range
    if (params.documentStartDate && params.documentEndDate) {
      builder.dateRange(
        "documentDate",
        new Date(params.documentStartDate),
        new Date(params.documentEndDate),
      );
    } else if (params.documentStartDate) {
      builder.greaterThanOrEqual(
        "documentDate",
        new Date(params.documentStartDate).toISOString(),
      );
    } else if (params.documentEndDate) {
      builder.lessThanOrEqual(
        "documentDate",
        new Date(params.documentEndDate).toISOString(),
      );
    }

    // Added date range
    if (params.addedStartDate && params.addedEndDate) {
      builder.dateRange(
        "addedDate",
        new Date(params.addedStartDate),
        new Date(params.addedEndDate),
      );
    }

    const filter = builder.build();
    // Use default 500 for counting, treat 0 as unspecified
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
      const points = Array.isArray(data.result?.points) ? data.result.points : [];

      let results = points.map((p: any) => ({
        content: p.payload?.content as string,
        metadata: {
          filePath: p.payload?.filePath,
          fileName: p.payload?.fileName,
          fileType: p.payload?.fileType,
          ...p.payload,
        },
        score: 1.0, // Metadata query doesn't have similarity score
      }));

      // Post-filter for tags with case-insensitive contains matching
      if (params.tags && Array.isArray(params.tags) && params.tags.length > 0) {
        const searchTags = params.tags.map((t: string) => t.toLowerCase());
        results = results.filter((result: any) => {
          const docTags = result.metadata.tags;
          if (!docTags) return false;

          // Handle both string (pipe-separated) and array formats
          const tagList: string[] = typeof docTags === 'string'
            ? docTags.split('|').map((t: string) => t.trim().toLowerCase())
            : Array.isArray(docTags)
            ? docTags.map((t: any) => String(t).toLowerCase())
            : [];

          // Check if any search tag is contained in any document tag
          return searchTags.some((searchTag: string) =>
            tagList.some((docTag: string) => docTag.includes(searchTag))
          );
        });
      }

      return results;
    } catch (error) {
      console.error("[PaperlessPlugin] Error querying by metadata:", error);
      return [];
    }
  }

  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: "search_paperless_by_tags",
        description:
          "Search Paperless documents by tags. Use this when the user asks about documents with specific tags or categories.",
        parameters: [
          {
            name: "tags",
            type: "array",
            required: true,
            description: "Array of tag names to search for",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description: "Maximum number of results (default: 20)",
          },
        ],
      },
      {
        name: "search_paperless_by_correspondent",
        description:
          "Search Paperless documents by correspondent/sender. Use this when the user asks about documents from a specific person or organization.",
        parameters: [
          {
            name: "correspondent",
            type: "string",
            required: true,
            description: "Name of the correspondent to search for",
          },
          {
            name: "limit",
            type: "number",
            required: false,
            description: "Maximum number of results (default: 20)",
          },
        ],
      },
      {
        name: "search_paperless_by_date",
        description:
          "Search Paperless documents by document date. Use this when the user asks about documents from a specific time period.",
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
            description: "Maximum number of results (default: 20)",
          },
        ],
      },
    ];
  }

  async scan(options?: any): Promise<ScanResult> {
    try {
      const { scanPaperlessDocuments } = await import("../indexer");

      const result = await scanPaperlessDocuments();

      return {
        indexed: result.indexedCount,
        deleted: result.deletedCount,
      };
    } catch (error) {
      console.error("[PaperlessPlugin] Error during scan:", error);
      return {
        indexed: 0,
        deleted: 0,
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  }

  async isConfigured(): Promise<boolean> {
    try {
      const client = await getPaperlessClient();
      return client !== null;
    } catch (error) {
      console.error("[PaperlessPlugin] Error checking configuration:", error);
      return false;
    }
  }
}

// Export singleton instance
export const paperlessPlugin = new PaperlessPlugin();
