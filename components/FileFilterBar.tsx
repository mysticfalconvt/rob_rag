"use client";

import styles from "./FileFilterBar.module.css";

interface FileFilterBarProps {
  showUploaded: boolean;
  showSynced: boolean;
  showPaperless: boolean;
  showGoodreads: boolean;
  showCustomOcr: boolean;
  showCalendar: boolean;
  uploadedCount: number;
  syncedCount: number;
  paperlessCount: number;
  goodreadsCount: number;
  customOcrCount: number;
  calendarCount: number;
  filteredCount: number;
  totalCount: number;
  onToggleUploaded: () => void;
  onToggleSynced: () => void;
  onTogglePaperless: () => void;
  onToggleGoodreads: () => void;
  onToggleCustomOcr: () => void;
  onToggleCalendar: () => void;
}

export default function FileFilterBar({
  showUploaded,
  showSynced,
  showPaperless,
  showGoodreads,
  showCustomOcr,
  showCalendar,
  uploadedCount,
  syncedCount,
  paperlessCount,
  goodreadsCount,
  customOcrCount,
  calendarCount,
  filteredCount,
  totalCount,
  onToggleUploaded,
  onToggleSynced,
  onTogglePaperless,
  onToggleGoodreads,
  onToggleCustomOcr,
  onToggleCalendar,
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
          <button
            className={`${styles.filterToggle} ${showCustomOcr ? styles.active : ""} ${customOcrCount === 0 ? styles.empty : ""}`}
            onClick={onToggleCustomOcr}
          >
            <i className="fas fa-eye"></i>
            Custom OCR
            <span className={styles.count}>({customOcrCount})</span>
          </button>
          <button
            className={`${styles.filterToggle} ${showCalendar ? styles.active : ""} ${calendarCount === 0 ? styles.empty : ""}`}
            onClick={onToggleCalendar}
          >
            <i className="fas fa-calendar"></i>
            Calendar
            <span className={styles.count}>({calendarCount})</span>
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
