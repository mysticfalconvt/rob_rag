"use client";

import styles from "./FilesHeader.module.css";

interface FilesHeaderProps {
  isScanning: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export default function FilesHeader({
  isScanning,
  onUpload,
  searchQuery,
  onSearchChange,
}: FilesHeaderProps) {
  return (
    <div className={styles.header}>
      <h1>Indexed Files</h1>
      <div className={styles.headerActions}>
        <div className={styles.searchContainer}>
          <i className="fas fa-search"></i>
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={styles.searchInput}
          />
          {searchQuery && (
            <button
              className={styles.clearButton}
              onClick={() => onSearchChange("")}
              title="Clear search"
            >
              <i className="fas fa-times"></i>
            </button>
          )}
        </div>
        <label className={styles.uploadButton}>
          <input
            type="file"
            onChange={onUpload}
            disabled={isScanning}
            style={{ display: "none" }}
          />
          <i className="fas fa-upload"></i>
          Upload File
        </label>
      </div>
    </div>
  );
}
