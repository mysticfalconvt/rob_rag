"use client";

import { useRef, useEffect } from "react";
import styles from "./ChatHeader.module.css";

interface ChatHeaderProps {
  conversationId: string | null;
  showMenu: boolean;
  isSaving: boolean;
  onToggleMenu: () => void;
  onSaveConversation: () => void;
  onDeleteConversation: () => void;
}

export default function ChatHeader({
  conversationId,
  showMenu,
  isSaving,
  onToggleMenu,
  onSaveConversation,
  onDeleteConversation,
}: ChatHeaderProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        // Close menu by toggling if it's open
        if (showMenu) {
          onToggleMenu();
        }
      }
    };

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMenu, onToggleMenu]);

  return (
    <div className={styles.header}>
      <h1>Chat with your Documents</h1>
      {conversationId && (
        <div className={styles.menuContainer} ref={menuRef}>
          <button
            className={styles.menuButton}
            onClick={onToggleMenu}
            disabled={isSaving}
            title="More options"
          >
            <i className="fas fa-ellipsis-v"></i>
          </button>
          {showMenu && (
            <div className={styles.menuDropdown}>
              <button
                className={styles.menuItem}
                onClick={onSaveConversation}
                disabled={isSaving}
              >
                <i className="fas fa-save"></i>
                {isSaving ? "Saving..." : "Save as Document"}
              </button>
              <button
                className={`${styles.menuItem} ${styles.danger}`}
                onClick={onDeleteConversation}
              >
                <i className="fas fa-trash"></i>
                Delete Conversation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
