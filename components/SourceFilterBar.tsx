"use client";

import styles from "./SourceFilterBar.module.css";

interface SourceFilterBarProps {
  useUploaded: boolean;
  useSynced: boolean;
  usePaperless: boolean;
  useGoodreads: boolean;
  onToggleUploaded: () => void;
  onToggleSynced: () => void;
  onTogglePaperless: () => void;
  onToggleGoodreads: () => void;
}

export default function SourceFilterBar({
  useUploaded,
  useSynced,
  usePaperless,
  useGoodreads,
  onToggleUploaded,
  onToggleSynced,
  onTogglePaperless,
  onToggleGoodreads,
}: SourceFilterBarProps) {

  return (
    <div className={styles.filterBar}>
      <span className={styles.filterLabel}>Search in:</span>
      <div className={styles.filterToggles}>
        <button
          type="button"
          className={`${styles.filterToggle} ${useUploaded ? styles.active : ""}`}
          onClick={onToggleUploaded}
        >
          <i className="fas fa-upload"></i>
          Uploaded
          <i
            className={`fas ${useUploaded ? "fa-check-circle" : "fa-circle"}`}
          ></i>
        </button>
        <button
          type="button"
          className={`${styles.filterToggle} ${useSynced ? styles.active : ""}`}
          onClick={onToggleSynced}
        >
          <i className="fas fa-sync"></i>
          Synced
          <i
            className={`fas ${useSynced ? "fa-check-circle" : "fa-circle"}`}
          ></i>
        </button>
        <button
          type="button"
          className={`${styles.filterToggle} ${usePaperless ? styles.active : ""}`}
          onClick={onTogglePaperless}
        >
          <i className="fas fa-file-archive"></i>
          Paperless
          <i
            className={`fas ${usePaperless ? "fa-check-circle" : "fa-circle"}`}
          ></i>
        </button>
        <button
          type="button"
          className={`${styles.filterToggle} ${useGoodreads ? styles.active : ""}`}
          onClick={onToggleGoodreads}
        >
          <i className="fas fa-book"></i>
          Goodreads
          <i
            className={`fas ${useGoodreads ? "fa-check-circle" : "fa-circle"}`}
          ></i>
        </button>
      </div>
    </div>
  );
}
