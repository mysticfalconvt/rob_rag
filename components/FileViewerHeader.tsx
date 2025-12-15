"use client";

import styles from "./FileViewerHeader.module.css";

interface FileViewerHeaderProps {
  fileName: string;
  source: string;
  paperlessUrl?: string;
  originalDocPath?: string;
  paperlessId?: number;
  onRevertOcr?: () => void;
}

export default function FileViewerHeader({
  fileName,
  source,
  paperlessUrl,
  originalDocPath,
  paperlessId,
  onRevertOcr,
}: FileViewerHeaderProps) {
  const isGoodreads = source === "goodreads";
  const isPaperless = source === "paperless";
  const isCustomOcr = source === "custom_ocr";
  const isUploaded = source === "uploaded";

  return (
    <div className={styles.header}>
      <div className={styles.titleSection}>
        <i
          className={`fas ${isGoodreads ? "fa-book" : isCustomOcr ? "fa-eye" : isPaperless ? "fa-file-archive" : isUploaded ? "fa-upload" : "fa-sync"} ${styles.icon}`}
        ></i>
        <h1>{fileName}</h1>
        <span
          className={`${styles.sourceBadge} ${
            isGoodreads
              ? styles.goodreads
              : isCustomOcr
                ? styles.customOcr
                : isPaperless
                  ? styles.paperless
                  : isUploaded
                    ? styles.uploaded
                    : styles.synced
          }`}
        >
          {isGoodreads ? (
            <>
              <i className="fas fa-book"></i> Goodreads Book
            </>
          ) : isCustomOcr ? (
            <>
              <i className="fas fa-eye"></i> Custom OCR
            </>
          ) : isPaperless ? (
            <>
              <i className="fas fa-file-archive"></i> Paperless-ngx
            </>
          ) : isUploaded ? (
            <>
              <i className="fas fa-upload"></i> Uploaded File
            </>
          ) : (
            <>
              <i className="fas fa-sync"></i> Synced File
            </>
          )}
        </span>
      </div>

      <div className={styles.actions}>
        {isCustomOcr && originalDocPath && paperlessId && (
          <>
            <a
              href={`/api/files/original/${paperlessId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.viewOriginal}
            >
              <i className="fas fa-file-pdf"></i> View Original PDF
            </a>
            {onRevertOcr && (
              <button
                onClick={onRevertOcr}
                className={styles.revertButton}
                title="Revert to Paperless OCR"
              >
                <i className="fas fa-undo"></i> Revert to Paperless OCR
              </button>
            )}
          </>
        )}
        {isPaperless && paperlessUrl && (
          <a
            href={paperlessUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.viewInPaperless}
          >
            <i className="fas fa-external-link-alt"></i> View in Paperless-ngx
          </a>
        )}
      </div>
    </div>
  );
}
