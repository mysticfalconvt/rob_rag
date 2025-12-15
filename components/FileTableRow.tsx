"use client";

import Link from "next/link";
import styles from "./FileTableRow.module.css";

interface IndexedFile {
  id: string;
  filePath: string;
  chunkCount: number;
  lastIndexed: string;
  status: string;
  needsReindexing?: boolean;
  fileMissing?: boolean;
  source: string;
  tags?: string[];
  paperlessId?: number;
  paperlessTitle?: string;
  paperlessTags?: string;
  paperlessCorrespondent?: string;
  goodreadsTitle?: string;
  goodreadsAuthor?: string;
  goodreadsRating?: number | null;
  userName?: string;
  useCustomOcr?: boolean;
  customOcrStatus?: string;
}

interface FileTableRowProps {
  file: IndexedFile;
  isScanning: boolean;
  onReindex: (filePath: string) => void;
  onDelete: (filePath: string) => void;
  onUseCustomOcr?: (paperlessId: number) => void;
}

export default function FileTableRow({
  file,
  isScanning,
  onReindex,
  onDelete,
  onUseCustomOcr,
}: FileTableRowProps) {
  const isPaperless = file.source === "paperless";
  const isCustomOcr = file.source === "custom_ocr" || file.useCustomOcr;
  const isGoodreads = file.source === "goodreads";
  const displayName = isPaperless || isCustomOcr
    ? file.paperlessTitle || `Document ${file.paperlessId}`
    : isGoodreads
      ? file.goodreadsTitle || "Unknown Book"
      : file.filePath.split("/").pop();

  let tags: string[] = [];
  if (isPaperless && file.paperlessTags) {
    try {
      tags = JSON.parse(file.paperlessTags);
    } catch (e) {
      console.error("Error parsing tags:", e);
    }
  }

  return (
    <tr
      className={
        isPaperless
          ? styles.paperlessRow
          : isGoodreads
            ? styles.goodreadsRow
            : ""
      }
    >
      <td>
        <span
          className={`${styles.sourceBadge} ${
            isCustomOcr
              ? styles.customOcr
              : isPaperless
                ? styles.paperless
                : isGoodreads
                  ? styles.goodreads
                  : file.source === "uploaded"
                    ? styles.uploaded
                    : styles.synced
          }`}
        >
          {isCustomOcr
            ? "✨ Custom OCR"
            : isPaperless
              ? "🗂️ Paperless"
              : isGoodreads
                ? "📚 Goodreads"
                : file.source === "uploaded"
                  ? "📤 Uploaded"
                  : "🔄 Synced"}
        </span>
      </td>
      <td className={styles.pathCell}>
        {isGoodreads ? (
          <div>
            <Link
              href={`/files/${encodeURIComponent(file.filePath)}`}
              className={styles.fileLink}
            >
              {displayName}
            </Link>
            {file.goodreadsAuthor && (
              <div className={styles.bookAuthor}>by {file.goodreadsAuthor}</div>
            )}
            {file.tags && file.tags.length > 0 && (
              <div className={styles.globalTags}>
                {file.tags.map((tag, idx) => (
                  <span key={idx} className={styles.globalTag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {file.goodreadsRating && (
              <div className={styles.bookRating}>
                {"⭐".repeat(file.goodreadsRating)}
              </div>
            )}
            {file.userName && (
              <div className={styles.userName}>{file.userName}'s library</div>
            )}
          </div>
        ) : isPaperless || isCustomOcr ? (
          <div>
            <Link
              href={`/files/${encodeURIComponent(file.filePath)}`}
              className={styles.fileLink}
            >
              {displayName}
            </Link>
            {file.tags && file.tags.length > 0 && (
              <div className={styles.globalTags}>
                {file.tags.map((tag, idx) => (
                  <span key={idx} className={styles.globalTag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {tags.length > 0 && (
              <div className={styles.tags}>
                {tags.map((tag, idx) => (
                  <span key={idx} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {file.paperlessCorrespondent && (
              <div className={styles.correspondent}>
                From: {file.paperlessCorrespondent}
              </div>
            )}
          </div>
        ) : (
          <div>
            <Link href={`/files${file.filePath}`} className={styles.fileLink}>
              {displayName}
            </Link>
            <span className={styles.fullPath}>{file.filePath}</span>
            {file.tags && file.tags.length > 0 && (
              <div className={styles.globalTags}>
                {file.tags.map((tag, idx) => (
                  <span key={idx} className={styles.globalTag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {file.fileMissing && (
              <span
                className={styles.missingBadge}
                title="File not found on disk"
              >
                Missing
              </span>
            )}
          </div>
        )}
      </td>
      <td>{file.chunkCount}</td>
      <td>
        <div className={styles.statusContainer}>
          <span className={`${styles.status} ${styles[file.status]}`}>
            {file.status}
          </span>
          {file.needsReindexing && !file.fileMissing && !isPaperless && (
            <span
              className={styles.updateBadge}
              title="File has changed since last index"
            >
              Needs Update
            </span>
          )}
        </div>
      </td>
      <td>{new Date(file.lastIndexed).toLocaleString()}</td>
      <td>
        <div className={styles.actionsCell}>
          {file.needsReindexing &&
            !file.fileMissing &&
            !isPaperless &&
            !isCustomOcr &&
            !isGoodreads && (
              <button
                onClick={() => onReindex(file.filePath)}
                className={styles.reindexButton}
                title="Re-index File"
                disabled={isScanning}
              >
                <i className={`fas fa-sync ${isScanning ? "fa-spin" : ""}`}></i>
              </button>
            )}
          {isPaperless && !isCustomOcr && onUseCustomOcr && file.paperlessId && (
            <button
              onClick={() => onUseCustomOcr(file.paperlessId!)}
              className={styles.ocrButton}
              title="Use Vision OCR for better text extraction"
              disabled={isScanning}
            >
              <i className="fas fa-eye"></i>
            </button>
          )}
          {file.customOcrStatus === "processing" && (
            <span className={styles.processingBadge} title="OCR in progress">
              <i className="fas fa-spinner fa-spin"></i> Processing...
            </span>
          )}
          {!isGoodreads && (
            <button
              onClick={() => onDelete(file.filePath)}
              className={styles.deleteButton}
              title={isPaperless || isCustomOcr ? "Remove from index" : "Delete file"}
            >
              <i className="fas fa-trash"></i>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
