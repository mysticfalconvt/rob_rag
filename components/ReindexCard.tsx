"use client";

import styles from "./ReindexCard.module.css";

interface ReindexCardProps {
  paperlessDocuments?: number;
  goodreadsBooks?: number;
  isReindexing: string | null;
  onReindexSource: (source: string, label: string) => void;
}

export default function ReindexCard({
  paperlessDocuments,
  goodreadsBooks,
  isReindexing,
  onReindexSource,
}: ReindexCardProps) {
  return (
    <div className={styles.card}>
      <h2>Reindex by Source (Full Regeneration)</h2>
      <p className={styles.description}>
        Reindex regenerates ALL embeddings for the selected source. Use this if embeddings need to be rebuilt from scratch (e.g., after model changes).
      </p>
      <div className={styles.reindexButtons}>
        <button
          onClick={() => onReindexSource("uploaded", "Uploaded")}
          disabled={isReindexing !== null}
          className={styles.reindexButton}
        >
          <i
            className={`fas fa-upload ${isReindexing === "uploaded" ? "fa-spin" : ""}`}
          ></i>
          {isReindexing === "uploaded" ? "Reindexing..." : "Reindex Uploaded"}
        </button>
        <button
          onClick={() => onReindexSource("synced", "Synced")}
          disabled={isReindexing !== null}
          className={styles.reindexButton}
        >
          <i
            className={`fas fa-sync ${isReindexing === "synced" ? "fa-spin" : ""}`}
          ></i>
          {isReindexing === "synced" ? "Reindexing..." : "Reindex Synced"}
        </button>
        {paperlessDocuments !== undefined && paperlessDocuments > 0 && (
          <button
            onClick={() => onReindexSource("paperless", "Paperless")}
            disabled={isReindexing !== null}
            className={styles.reindexButton}
          >
            <i
              className={`fas fa-file-archive ${isReindexing === "paperless" ? "fa-spin" : ""}`}
            ></i>
            {isReindexing === "paperless"
              ? "Reindexing..."
              : `Reindex Paperless (${paperlessDocuments})`}
          </button>
        )}
        {goodreadsBooks !== undefined && goodreadsBooks > 0 && (
          <button
            onClick={() => onReindexSource("goodreads", "Goodreads")}
            disabled={isReindexing !== null}
            className={styles.reindexButton}
          >
            <i
              className={`fas fa-book ${isReindexing === "goodreads" ? "fa-spin" : ""}`}
            ></i>
            {isReindexing === "goodreads"
              ? "Reindexing..."
              : `Reindex Goodreads (${goodreadsBooks})`}
          </button>
        )}
      </div>
    </div>
  );
}
