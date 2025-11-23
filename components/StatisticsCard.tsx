"use client";

import styles from "./StatisticsCard.module.css";

interface StatisticsCardProps {
  totalFiles: number;
  totalChunks: number;
  uploadedFiles?: number;
  syncedFiles?: number;
  paperlessDocuments?: number;
  goodreadsBooks?: number;
  goodreadsUsers?: number;
  averageChunksPerFile?: number;
}

export default function StatisticsCard({
  totalFiles,
  totalChunks,
  uploadedFiles,
  syncedFiles,
  paperlessDocuments,
  goodreadsBooks,
  goodreadsUsers,
  averageChunksPerFile,
}: StatisticsCardProps) {
  return (
    <div className={styles.card}>
      <h2>Statistics</h2>

      <div className={styles.statsGrid}>
        <div className={styles.stat}>
          <span className={styles.value}>{totalFiles}</span>
          <span className={styles.label}>Total Files</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.value}>{totalChunks}</span>
          <span className={styles.label}>Total Chunks</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.value}>
            {averageChunksPerFile ? averageChunksPerFile.toFixed(1) : "0"}
          </span>
          <span className={styles.label}>Avg Chunks/File</span>
        </div>
      </div>

      <div className={styles.divider}></div>

      <h3 className={styles.subtitle}>By Source</h3>
      <div className={styles.sourceStats}>
        {uploadedFiles !== undefined && (
          <div className={styles.sourceStat}>
            <i className="fas fa-upload"></i>
            <span className={styles.sourceLabel}>Uploaded</span>
            <span className={styles.sourceValue}>{uploadedFiles}</span>
          </div>
        )}
        {syncedFiles !== undefined && (
          <div className={styles.sourceStat}>
            <i className="fas fa-sync"></i>
            <span className={styles.sourceLabel}>Synced</span>
            <span className={styles.sourceValue}>{syncedFiles}</span>
          </div>
        )}
        {paperlessDocuments !== undefined && paperlessDocuments > 0 && (
          <div className={styles.sourceStat}>
            <i className="fas fa-file-archive"></i>
            <span className={styles.sourceLabel}>Paperless</span>
            <span className={styles.sourceValue}>{paperlessDocuments}</span>
          </div>
        )}
        {goodreadsBooks !== undefined && goodreadsBooks > 0 && (
          <div className={styles.sourceStat}>
            <i className="fas fa-book"></i>
            <span className={styles.sourceLabel}>Goodreads Books</span>
            <span className={styles.sourceValue}>{goodreadsBooks}</span>
          </div>
        )}
        {goodreadsUsers !== undefined && goodreadsUsers > 0 && (
          <div className={styles.sourceStat}>
            <i className="fas fa-user"></i>
            <span className={styles.sourceLabel}>Goodreads Users</span>
            <span className={styles.sourceValue}>{goodreadsUsers}</span>
          </div>
        )}
      </div>
    </div>
  );
}
