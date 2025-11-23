"use client";

import styles from "./FileMetadata.module.css";

interface Metadata {
  size?: number;
  lastModified?: string;
  chunkCount: number;
  lastIndexed: string;
  author?: string;
  rating?: number | null;
  dateRead?: string | null;
  dateAdded?: string | null;
  shelves?: string[];
  userName?: string;
}

interface FileMetadataProps {
  source: string;
  fileType: string;
  metadata: Metadata;
  paperlessTags?: string[];
  paperlessCorrespondent?: string;
}

export default function FileMetadata({
  source,
  fileType,
  metadata,
  paperlessTags,
  paperlessCorrespondent,
}: FileMetadataProps) {
  const isGoodreads = source === "goodreads";
  const isPaperless = source === "paperless";

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className={styles.metadata}>
      {isGoodreads && metadata.author && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>Author:</span>
          <span className={styles.metadataValue}>{metadata.author}</span>
        </div>
      )}
      {isGoodreads && metadata.rating && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>My Rating:</span>
          <span className={styles.metadataValue}>
            {"⭐".repeat(metadata.rating)}
          </span>
        </div>
      )}
      {isGoodreads && metadata.dateRead && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>Date Read:</span>
          <span className={styles.metadataValue}>
            {formatDate(metadata.dateRead)}
          </span>
        </div>
      )}
      {isGoodreads && metadata.shelves && metadata.shelves.length > 0 && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>Shelves:</span>
          <span className={styles.metadataValue}>
            {metadata.shelves.map((shelf, idx) => (
              <span key={idx} className={styles.tag}>
                {shelf}
              </span>
            ))}
          </span>
        </div>
      )}
      {isGoodreads && metadata.userName && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>Library:</span>
          <span className={styles.metadataValue}>{metadata.userName}</span>
        </div>
      )}
      {isPaperless && paperlessTags && paperlessTags.length > 0 && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>Tags:</span>
          <span className={styles.metadataValue}>
            {paperlessTags.map((tag, idx) => (
              <span key={idx} className={styles.tag}>
                {tag}
              </span>
            ))}
          </span>
        </div>
      )}
      {isPaperless && paperlessCorrespondent && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>Correspondent:</span>
          <span className={styles.metadataValue}>{paperlessCorrespondent}</span>
        </div>
      )}
      {!isGoodreads && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>Type:</span>
          <span className={styles.metadataValue}>
            {isPaperless ? "Paperless Document" : fileType.toUpperCase()}
          </span>
        </div>
      )}
      {!isGoodreads && metadata.size && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>Size:</span>
          <span className={styles.metadataValue}>
            {formatFileSize(metadata.size)}
          </span>
        </div>
      )}
      <div className={styles.metadataItem}>
        <span className={styles.metadataLabel}>Chunks:</span>
        <span className={styles.metadataValue}>{metadata.chunkCount}</span>
      </div>
      {!isGoodreads && metadata.lastModified && (
        <div className={styles.metadataItem}>
          <span className={styles.metadataLabel}>Last Modified:</span>
          <span className={styles.metadataValue}>
            {formatDate(metadata.lastModified)}
          </span>
        </div>
      )}
      <div className={styles.metadataItem}>
        <span className={styles.metadataLabel}>Last Indexed:</span>
        <span className={styles.metadataValue}>
          {formatDate(metadata.lastIndexed)}
        </span>
      </div>
    </div>
  );
}
