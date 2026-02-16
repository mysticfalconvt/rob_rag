import prisma from "./prisma";
import { getPaperlessClient } from "./paperless";
import { indexPaperlessDocument } from "./indexer";
import { startOcrJob } from "./visionOcr";

interface SyncFilters {
  tags?: string[];
  minDate?: string;
  maxDate?: string;
}

export interface PaperlessSyncResult {
  newDocuments: number;
  updatedDocuments: number;
  skippedDocuments: number;
  ocrJobsStarted: number;
  errors: string[];
}

/**
 * Fetch and sync new/updated Paperless documents based on filters
 */
export async function syncPaperlessDocuments(
  filters?: SyncFilters,
  autoOcr: boolean = false,
  visionModel?: string,
  forceReindex: boolean = false
): Promise<PaperlessSyncResult> {
  const result: PaperlessSyncResult = {
    newDocuments: 0,
    updatedDocuments: 0,
    skippedDocuments: 0,
    ocrJobsStarted: 0,
    errors: [],
  };

  try {
    console.log("[PaperlessSync] Starting sync with filters:", filters);

    // Get Paperless client
    const client = await getPaperlessClient();
    if (!client) {
      throw new Error("Paperless-ngx not configured or not enabled");
    }

    // Fetch all documents from Paperless
    const allDocuments = await client.getAllDocuments();
    console.log(`[PaperlessSync] Found ${allDocuments.length} total documents in Paperless`);

    // Apply filters
    let filteredDocuments = allDocuments;

    // Filter by tags
    if (filters?.tags && filters.tags.length > 0) {
      const tagNames = filters.tags.map(t => t.toLowerCase());
      filteredDocuments = filteredDocuments.filter(doc => {
        // We need to fetch tag names for each document
        // For performance, we'll do this in the main loop
        return true; // Placeholder, will filter in the loop
      });
    }

    // Filter by date
    if (filters?.minDate) {
      const minDate = new Date(filters.minDate);
      filteredDocuments = filteredDocuments.filter(doc => {
        const docDate = new Date(doc.created);
        return docDate >= minDate;
      });
    }

    if (filters?.maxDate) {
      const maxDate = new Date(filters.maxDate);
      filteredDocuments = filteredDocuments.filter(doc => {
        const docDate = new Date(doc.created);
        return docDate <= maxDate;
      });
    }

    console.log(`[PaperlessSync] After filtering: ${filteredDocuments.length} documents to process`);

    // Process each document
    for (const doc of filteredDocuments) {
      try {
        const filePath = `paperless://${doc.id}`;

        // Get metadata (including tags)
        const metadata = await client.getDocumentMetadata(doc.id);

        // Apply tag filter if specified
        if (filters?.tags && filters.tags.length > 0) {
          const hasMatchingTag = metadata.tags.some(tag =>
            filters.tags!.some(filterTag =>
              tag.toLowerCase() === filterTag.toLowerCase()
            )
          );
          if (!hasMatchingTag) {
            result.skippedDocuments++;
            continue;
          }
        }

        // Check if document exists and needs updating
        const existingFile = await prisma.indexedFile.findUnique({
          where: { filePath },
        });

        const modifiedDate = new Date(doc.modified);
        const isNew = !existingFile;

        // Determine if update is needed
        if (existingFile && !forceReindex) {
          const hasBeenModified = existingFile.lastModified && modifiedDate > existingFile.lastModified;
          const shouldUseCustomOcr = autoOcr && visionModel;

          // Check if custom OCR has actually been completed successfully
          const hasCompletedCustomOcr = existingFile.useCustomOcr &&
                                         existingFile.customOcrStatus === "completed" &&
                                         existingFile.sourceOverride === "custom_ocr";

          // Skip only if:
          // 1. Document hasn't been modified, AND
          // 2. Either we don't want custom OCR, OR custom OCR is already completed
          if (!hasBeenModified) {
            if (!shouldUseCustomOcr) {
              // Don't want custom OCR and doc is up to date
              result.skippedDocuments++;
              continue;
            }

            if (hasCompletedCustomOcr) {
              // Custom OCR already completed successfully
              result.skippedDocuments++;
              continue;
            }
          }

          // If we get here, either doc was modified or custom OCR needs to be done/redone
          if (shouldUseCustomOcr && !hasCompletedCustomOcr) {
            console.log(`[PaperlessSync] Document ${doc.id} needs custom OCR (status: ${existingFile.customOcrStatus || 'none'})`);
          }
        }

        // Fetch document content
        const content = await client.getDocumentContent(doc.id);

        // Index the document with Paperless OCR
        await indexPaperlessDocument({ ...doc, content }, metadata);

        if (isNew) {
          console.log(`[PaperlessSync] ✅ Imported new document: ${metadata.title} (${doc.id})`);
          result.newDocuments++;
        } else {
          console.log(`[PaperlessSync] ✅ Updated document: ${metadata.title} (${doc.id})`);
          result.updatedDocuments++;
        }

        // Start OCR job if auto-OCR is enabled (for new or updated docs)
        if (autoOcr && visionModel) {
          try {
            const jobId = await startOcrJob(doc.id, visionModel);
            console.log(`[PaperlessSync] Started OCR job ${jobId} for document ${doc.id}`);
            result.ocrJobsStarted++;
          } catch (ocrError: any) {
            const errorMsg = `Failed to start OCR for document ${doc.id}: ${ocrError.message}`;
            console.error(`[PaperlessSync] ${errorMsg}`);
            result.errors.push(errorMsg);
          }
        }
      } catch (docError: any) {
        const errorMsg = `Failed to sync document ${doc.id}: ${docError.message}`;
        console.error(`[PaperlessSync] ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    console.log("[PaperlessSync] Sync complete:", result);
    return result;
  } catch (error: any) {
    console.error("[PaperlessSync] Error during sync:", error);
    result.errors.push(error.message || "Unknown error");
    return result;
  }
}

/**
 * Get sync settings from database
 */
export async function getPaperlessSyncSettings() {
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
    select: {
      visionModel: true,
    },
  });

  if (!settings) {
    return null;
  }

  // Return minimal settings for backward compatibility
  // Paperless sync is now part of unified daily sync
  return {
    enabled: false,
    interval: 60,
    lastRun: null,
    filters: null,
    autoOcr: false,
    visionModel: settings.visionModel,
  };
}

/**
 * Background sync job - DEPRECATED
 * Paperless sync is now part of unified daily sync (see lib/syncAll.ts)
 * This function is kept for backward compatibility but always returns null.
 */
export async function runScheduledSync(): Promise<PaperlessSyncResult | null> {
  console.log("[PaperlessSync] runScheduledSync is deprecated - use unified sync instead");
  return null;
}
