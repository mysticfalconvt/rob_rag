"use client";

import Link from "next/link";
import styles from "./FileViewerHeader.module.css";

interface FileViewerHeaderProps {
  fileName: string;
  filePath: string;
  source: string;
  paperlessUrl?: string;
  originalDocPath?: string;
  paperlessId?: number;
  onRevertOcr?: () => void;
}

export default function FileViewerHeader({
  fileName,
  filePath,
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

  const chatAboutDocHref = `/?document=${encodeURIComponent(filePath)}`;

  return (
    <div className={styles.header}>
      <div className={styles.titleSection}>
        <i
          className={`fas ${isGoodreads ? "fa-book" : isCustomOcr ? "fa-eye" : isPaperless ? "fa-file-archive" : isUploaded ? "fa-upload" : "fa-sync"} ${styles.icon}`}
        ></i>
        <h1>{fileName}</h1>
        <span
          className={`${styles.sourceBadge} ${isGoodreads
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
        <Link
          href={chatAboutDocHref}
          className={styles.chatAboutDoc}
          title="Start a chat using only this document as context"
        >
          <i className="fas fa-comments"></i> Chat about this doc
        </Link>
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
