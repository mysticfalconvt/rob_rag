"use client";

import styles from "./FileViewerHeader.module.css";

interface FileViewerHeaderProps {
  fileName: string;
  source: string;
  paperlessUrl?: string;
}

export default function FileViewerHeader({
  fileName,
  source,
  paperlessUrl,
}: FileViewerHeaderProps) {
  const isGoodreads = source === "goodreads";
  const isPaperless = source === "paperless";
  const isUploaded = source === "uploaded";

  return (
    <div className={styles.header}>
      <div className={styles.titleSection}>
        <i
          className={`fas ${isGoodreads ? "fa-book" : isPaperless ? "fa-file-archive" : isUploaded ? "fa-upload" : "fa-sync"} ${styles.icon}`}
        ></i>
        <h1>{fileName}</h1>
        <span
          className={`${styles.sourceBadge} ${
            isGoodreads
              ? styles.goodreads
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

      {isPaperless && paperlessUrl && (
        <div className={styles.paperlessLink}>
          <a
            href={paperlessUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.viewInPaperless}
          >
            <i className="fas fa-external-link-alt"></i> View in Paperless-ngx
          </a>
        </div>
      )}
    </div>
  );
}
