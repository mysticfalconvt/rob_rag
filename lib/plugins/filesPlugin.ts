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

/**
 * Files data source plugin
 * Handles both "uploaded" (File Uploads folder) and "synced" (other documents)
 */
export class FilesPlugin implements DataSourcePlugin {
  name = "files";
  displayName = "Files";

  capabilities: DataSourceCapabilities = {
    supportsMetadataQuery: true,
    supportsSemanticSearch: true,
    supportsScanning: true,
    requiresAuthentication: false,
  };

  getMetadataSchema(): MetadataField[] {
    return [
      {
        name: "fileType",
        displayName: "File Type",
        type: "string",
        queryable: true,
        filterable: true,
        description: "File extension (pdf, txt, md, etc.)",
      },
      {
        name: "filePath",
        displayName: "File Path",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Full path to the file",
      },
      {
        name: "fileName",
        displayName: "File Name",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Name of the file",
      },
      {
        name: "source",
        displayName: "Source Type",
        type: "string",
        queryable: true,
        filterable: true,
        description: "Either 'uploaded' or 'synced'",
      },
      {
        name: "userId",
        displayName: "User ID",
        type: "string",
        queryable: true,
        filterable: true,
        description: "User who uploaded the file (for uploaded files)",
      },
    ];
  }

  async queryByMetadata(params: QueryParams): Promise<SearchResult[]> {
    const builder = createQueryBuilder();

    // Source filter (uploaded or synced)
    if (params.source) {
      if (params.source === "uploaded" || params.source === "synced") {
        builder.source(params.source);
      } else {
        // Default to both uploaded and synced
        builder.sources(["uploaded", "synced"]);
      }
    } else {
      // Default to both uploaded and synced
      builder.sources(["uploaded", "synced"]);
    }

    // User ID filter (for uploaded files)
    if (params.userId) {
      builder.userId(params.userId);
    }

    // File type filter
    if (params.fileType) {
      builder.equals("fileType", params.fileType);
    }

    // File name contains (partial match - limited by Qdrant capabilities)
    if (params.fileName) {
      builder.equals("fileName", params.fileName);
    }

    const filter = builder.build();
    const limit = params.limit || 20;

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

      return points.map((p: any) => ({
        content: p.payload?.content as string,
        metadata: {
          filePath: p.payload?.filePath,
          fileName: p.payload?.fileName,
          fileType: p.payload?.fileType,
          ...p.payload,
        },
        score: 1.0,
      }));
    } catch (error) {
      console.error("[FilesPlugin] Error querying by metadata:", error);
      return [];
    }
  }

  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: "search_files_by_type",
        description:
          "Search files by file type/extension. Use this when the user asks about specific document types (PDF, markdown, text files, etc.).",
        parameters: [
          {
            name: "fileType",
            type: "string",
            required: true,
            description: "File extension (pdf, txt, md, docx, etc.)",
          },
          {
            name: "source",
            type: "string",
            required: false,
            description: "Filter by source: 'uploaded' or 'synced'",
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
        name: "search_uploaded_files",
        description:
          "Search only user-uploaded files. Use this when the user specifically asks about files they uploaded.",
        parameters: [
          {
            name: "fileType",
            type: "string",
            required: false,
            description: "Filter by file extension",
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

  async scan(options?: { source?: "uploaded" | "synced" | "all" }): Promise<ScanResult> {
    try {
      const source = options?.source || "all";

      if (source === "uploaded" || source === "all") {
        // Scan uploaded files
        const { getAllFiles } = await import("../files");
        const { indexFile } = await import("../indexer");
        const path = await import("path");
        const prisma = await import("../prisma");

        const allFiles = await getAllFiles(config.DOCUMENTS_FOLDER_PATH);
        const uploadedFiles = allFiles.filter((f) => f.includes("/File Uploads/"));

        let indexed = 0;
        for (const filePath of uploadedFiles) {
          try {
            await indexFile(filePath);
            indexed++;
          } catch (error) {
            console.error(`[FilesPlugin] Failed to index ${filePath}:`, error);
          }
        }

        // Remove deleted uploaded files from index
        const dbFiles = await prisma.default.indexedFile.findMany({
          where: { source: "uploaded" },
          select: { filePath: true },
        });

        let deleted = 0;
        const { deleteFileIndex } = await import("../indexer");
        for (const dbFile of dbFiles) {
          if (!allFiles.includes(dbFile.filePath)) {
            try {
              await deleteFileIndex(dbFile.filePath);
              deleted++;
            } catch (error) {
              console.error(
                `[FilesPlugin] Failed to delete index for ${dbFile.filePath}:`,
                error,
              );
            }
          }
        }

        return { indexed, deleted };
      }

      if (source === "synced") {
        // Scan synced/local files
        const { scanAllFiles } = await import("../indexer");
        const result = await scanAllFiles();

        return {
          indexed: result.localIndexed,
          deleted: result.localDeleted,
        };
      }

      return { indexed: 0, deleted: 0 };
    } catch (error) {
      console.error("[FilesPlugin] Error during scan:", error);
      return {
        indexed: 0,
        deleted: 0,
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  }

  async isConfigured(): Promise<boolean> {
    // Files plugin is always configured as long as DOCUMENTS_FOLDER_PATH exists
    try {
      const fs = await import("fs/promises");
      await fs.access(config.DOCUMENTS_FOLDER_PATH);
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
export const filesPlugin = new FilesPlugin();
