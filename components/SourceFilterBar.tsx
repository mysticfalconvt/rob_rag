"use client";

import styles from "./SourceFilterBar.module.css";

interface GoodreadsUser {
  id: string;
  name: string;
  enabled: boolean;
}

interface SourceFilterBarProps {
  useUploaded: boolean;
  useSynced: boolean;
  usePaperless: boolean;
  goodreadsUsers: GoodreadsUser[];
  onToggleUploaded: () => void;
  onToggleSynced: () => void;
  onTogglePaperless: () => void;
  onToggleGoodreadsUser: (userId: string) => void;
}

export default function SourceFilterBar({
  useUploaded,
  useSynced,
  usePaperless,
  goodreadsUsers,
  onToggleUploaded,
  onToggleSynced,
  onTogglePaperless,
  onToggleGoodreadsUser,
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
        {goodreadsUsers.map((user) => (
          <button
            key={user.id}
            type="button"
            className={`${styles.filterToggle} ${user.enabled ? styles.active : ""}`}
            onClick={() => onToggleGoodreadsUser(user.id)}
          >
            <i className="fas fa-book"></i>
            {user.name}
            <i
              className={`fas ${user.enabled ? "fa-check-circle" : "fa-circle"}`}
            ></i>
          </button>
        ))}
      </div>
    </div>
  );
}
