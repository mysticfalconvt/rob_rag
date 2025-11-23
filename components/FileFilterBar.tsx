"use client";

import styles from "./FileFilterBar.module.css";

interface FileFilterBarProps {
  showUploaded: boolean;
  showSynced: boolean;
  showPaperless: boolean;
  showGoodreads: boolean;
  uploadedCount: number;
  syncedCount: number;
  paperlessCount: number;
  goodreadsCount: number;
  filteredCount: number;
  totalCount: number;
  onToggleUploaded: () => void;
  onToggleSynced: () => void;
  onTogglePaperless: () => void;
  onToggleGoodreads: () => void;
}

export default function FileFilterBar({
  showUploaded,
  showSynced,
  showPaperless,
  showGoodreads,
  uploadedCount,
  syncedCount,
  paperlessCount,
  goodreadsCount,
  filteredCount,
  totalCount,
  onToggleUploaded,
  onToggleSynced,
  onTogglePaperless,
  onToggleGoodreads,
}: FileFilterBarProps) {
  return (
    <div className={styles.filterBar}>
      <div className={styles.filterSection}>
        <span className={styles.filterLabel}>Show:</span>
        <div className={styles.filterToggles}>
          <button
            className={`${styles.filterToggle} ${showUploaded ? styles.active : ""} ${uploadedCount === 0 ? styles.empty : ""}`}
            onClick={onToggleUploaded}
          >
            <i className="fas fa-upload"></i>
            Uploaded
            <span className={styles.count}>({uploadedCount})</span>
          </button>
          <button
            className={`${styles.filterToggle} ${showSynced ? styles.active : ""} ${syncedCount === 0 ? styles.empty : ""}`}
            onClick={onToggleSynced}
          >
            <i className="fas fa-sync"></i>
            Synced
            <span className={styles.count}>({syncedCount})</span>
          </button>
          <button
            className={`${styles.filterToggle} ${showPaperless ? styles.active : ""} ${paperlessCount === 0 ? styles.empty : ""}`}
            onClick={onTogglePaperless}
          >
            <i className="fas fa-file-archive"></i>
            Paperless
            <span className={styles.count}>({paperlessCount})</span>
          </button>
          <button
            className={`${styles.filterToggle} ${showGoodreads ? styles.active : ""} ${goodreadsCount === 0 ? styles.empty : ""}`}
            onClick={onToggleGoodreads}
          >
            <i className="fas fa-book"></i>
            Goodreads
            <span className={styles.count}>({goodreadsCount})</span>
          </button>
        </div>
      </div>
      <div className={styles.statsSection}>
        <span className={styles.statsText}>
          Showing {filteredCount} of {totalCount} files
        </span>
      </div>
    </div>
  );
}
