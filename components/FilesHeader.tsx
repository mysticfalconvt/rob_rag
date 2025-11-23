"use client";

import styles from "./FilesHeader.module.css";

interface FilesHeaderProps {
  isScanning: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onScan: () => void;
  onForceReindex: () => void;
}

export default function FilesHeader({
  isScanning,
  onUpload,
  onScan,
  onForceReindex,
}: FilesHeaderProps) {
  return (
    <div className={styles.header}>
      <h1>Indexed Files</h1>
      <div className={styles.headerActions}>
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
        <button
          onClick={onScan}
          disabled={isScanning}
          className={styles.scanButton}
        >
          <i className={`fas fa-sync ${isScanning ? "fa-spin" : ""}`}></i>
          {isScanning ? "Scanning..." : "Scan Now"}
        </button>
        <button
          onClick={onForceReindex}
          disabled={isScanning}
          className={styles.forceReindexButton}
          title="Clear index and re-scan all files"
        >
          <i className={`fas fa-redo ${isScanning ? "fa-spin" : ""}`}></i>
          Force Reindex All
        </button>
      </div>
    </div>
  );
}
