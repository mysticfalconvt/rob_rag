"use client";

import styles from "./ScanCard.module.css";

interface ScanCardProps {
  uploadedFiles?: number;
  syncedFiles?: number;
  paperlessDocuments?: number;
  paperlessEnabled?: boolean;
  goodreadsBooks?: number;
  isScanning: string | null;
  onScanSource: (source: string, label: string) => void;
  onScanAll: () => void;
  onForceReindexAll: () => void;
}

export default function ScanCard({
  uploadedFiles,
  syncedFiles,
  paperlessDocuments,
  paperlessEnabled,
  goodreadsBooks,
  isScanning,
  onScanSource,
  onScanAll,
  onForceReindexAll,
}: ScanCardProps) {
  return (
    <div className={styles.card}>
      <h2>Scan & Index</h2>

      <div className={styles.section}>
        <h3>Scan All Sources</h3>
        <div className={styles.scanButtons}>
          <button
            onClick={onScanAll}
            disabled={isScanning !== null}
            className={styles.scanButton}
          >
            <i
              className={`fas fa-sync ${isScanning === "all" ? "fa-spin" : ""}`}
            ></i>
            {isScanning === "all" ? "Scanning..." : "Scan All Now"}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <h3>Scan by Source</h3>
        <div className={styles.scanButtons}>
          {uploadedFiles !== undefined && (
            <button
              onClick={() => onScanSource("uploaded", "Uploaded")}
              disabled={isScanning !== null}
              className={styles.scanButton}
            >
              <i
                className={`fas fa-upload ${isScanning === "uploaded" ? "fa-spin" : ""}`}
              ></i>
              {isScanning === "uploaded"
                ? "Scanning..."
                : `Scan Uploaded Files (${uploadedFiles})`}
            </button>
          )}
          {syncedFiles !== undefined && (
            <button
              onClick={() => onScanSource("local", "Local")}
              disabled={isScanning !== null}
              className={styles.scanButton}
            >
              <i
                className={`fas fa-folder ${isScanning === "local" ? "fa-spin" : ""}`}
              ></i>
              {isScanning === "local"
                ? "Scanning..."
                : `Scan Local Files (${syncedFiles})`}
            </button>
          )}
          {paperlessEnabled && (
            <button
              onClick={() => onScanSource("paperless", "Paperless")}
              disabled={isScanning !== null}
              className={styles.scanButton}
            >
              <i
                className={`fas fa-file-archive ${isScanning === "paperless" ? "fa-spin" : ""}`}
              ></i>
              {isScanning === "paperless"
                ? "Scanning..."
                : `Scan Paperless${paperlessDocuments !== undefined ? ` (${paperlessDocuments})` : ""}`}
            </button>
          )}
          {goodreadsBooks !== undefined && goodreadsBooks > 0 && (
            <button
              onClick={() => onScanSource("goodreads", "Goodreads")}
              disabled={isScanning !== null}
              className={styles.scanButton}
            >
              <i
                className={`fas fa-book ${isScanning === "goodreads" ? "fa-spin" : ""}`}
              ></i>
              {isScanning === "goodreads"
                ? "Scanning..."
                : `Scan Goodreads (${goodreadsBooks})`}
            </button>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <h3>Force Reindex</h3>
        <div className={styles.scanButtons}>
          <button
            onClick={onForceReindexAll}
            disabled={isScanning !== null}
            className={`${styles.scanButton} ${styles.dangerButton}`}
          >
            <i
              className={`fas fa-exclamation-triangle ${isScanning === "reindex" ? "fa-spin" : ""}`}
            ></i>
            {isScanning === "reindex" ? "Reindexing..." : "Force Reindex All"}
          </button>
        </div>
      </div>
    </div>
  );
}
