"use client";

import { useRef, useEffect } from "react";
import styles from "./ChatHeader.module.css";

interface ChatHeaderProps {
  conversationId: string | null;
  showMenu: boolean;
  isSaving: boolean;
  appName: string;
  onToggleMenu: () => void;
  onSaveConversation: () => void;
  onDeleteConversation: () => void;
}

export default function ChatHeader({
  conversationId,
  showMenu,
  isSaving,
  appName,
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

  const handleMobileMenuClick = () => {
    // Dispatch custom event to open sidebar menu
    window.dispatchEvent(new CustomEvent('openMobileMenu'));
  };

  return (
    <div className={styles.header}>
      <button
        className={styles.mobileHamburger}
        onClick={handleMobileMenuClick}
        aria-label="Open menu"
      >
        <i className="fas fa-bars"></i>
      </button>
      <h1>
        <span className={styles.desktopTitle}>Chat with your Documents</span>
        <span className={styles.mobileTitle}>
          <i className="fas fa-robot"></i>
          <span>{appName}</span>
        </span>
      </h1>
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
