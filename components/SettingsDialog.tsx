"use client";

import { useRef, useEffect } from "react";
import styles from "./SettingsDialog.module.css";

interface GoodreadsUser {
  id: string;
  name: string;
  enabled: boolean;
}

interface SettingsDialogProps {
  isOpen: boolean;
  useUploaded: boolean;
  useSynced: boolean;
  usePaperless: boolean;
  goodreadsUsers: GoodreadsUser[];
  conversationId: string | null;
  isSaving: boolean;
  onClose: () => void;
  onToggleUploaded: () => void;
  onToggleSynced: () => void;
  onTogglePaperless: () => void;
  onToggleGoodreadsUser: (userId: string) => void;
  onSaveConversation: () => void;
  onDeleteConversation: () => void;
}

export default function SettingsDialog({
  isOpen,
  useUploaded,
  useSynced,
  usePaperless,
  goodreadsUsers,
  conversationId,
  isSaving,
  onClose,
  onToggleUploaded,
  onToggleSynced,
  onTogglePaperless,
  onToggleGoodreadsUser,
  onSaveConversation,
  onDeleteConversation,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog} ref={dialogRef}>
        <div className={styles.header}>
          <h2>Settings</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className={styles.content}>
          <div className={styles.section}>
            <h3>Source Filters</h3>
            <p className={styles.description}>
              Select which document sources to search when retrieving context.
            </p>
            <div className={styles.filterToggles}>
              <button
                type="button"
                className={`${styles.filterToggle} ${useUploaded ? styles.active : ""}`}
                onClick={onToggleUploaded}
              >
                <i className="fas fa-upload"></i>
                <span>Uploaded</span>
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
                <span>Synced</span>
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
                <span>Paperless</span>
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
                  <span>{user.name}</span>
                  <i
                    className={`fas ${user.enabled ? "fa-check-circle" : "fa-circle"}`}
                  ></i>
                </button>
              ))}
            </div>
          </div>

          {conversationId && (
            <div className={styles.section}>
              <h3>Conversation Actions</h3>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={onSaveConversation}
                  disabled={isSaving}
                >
                  <i className="fas fa-save"></i>
                  {isSaving ? "Saving..." : "Save as Document"}
                </button>
                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.danger}`}
                  onClick={onDeleteConversation}
                >
                  <i className="fas fa-trash"></i>
                  Delete Conversation
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
