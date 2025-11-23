"use client";

import { useRef, useEffect } from "react";
import styles from "./ChatInput.module.css";
import SettingsDialog from "./SettingsDialog";

interface ChatInputProps {
  value: string;
  isLoading: boolean;
  sourceCount: number;
  showSettings: boolean;
  showMenu: boolean;
  useUploaded: boolean;
  useSynced: boolean;
  usePaperless: boolean;
  useGoodreads: boolean;
  conversationId: string | null;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onSourceCountChange: (count: number) => void;
  onToggleSettings: () => void;
  onToggleMenu: () => void;
  onToggleUploaded: () => void;
  onToggleSynced: () => void;
  onTogglePaperless: () => void;
  onToggleGoodreads: () => void;
  onSaveConversation: () => void;
  onDeleteConversation: () => void;
}

export default function ChatInput({
  value,
  isLoading,
  sourceCount,
  showSettings,
  showMenu,
  useUploaded,
  useSynced,
  usePaperless,
  useGoodreads,
  conversationId,
  isSaving,
  onChange,
  onSubmit,
  onSourceCountChange,
  onToggleSettings,
  onToggleMenu,
  onToggleUploaded,
  onToggleSynced,
  onTogglePaperless,
  onToggleGoodreads,
  onSaveConversation,
  onDeleteConversation,
}: ChatInputProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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
    <>
      <form onSubmit={onSubmit} className={styles.inputForm}>
        <div className={styles.inputWrapper}>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
          />
          <div className={styles.menuContainer} ref={menuRef}>
            <button
              type="button"
              className={styles.menuButton}
              onClick={onToggleMenu}
              title="More options"
            >
              <i className="fas fa-ellipsis-v"></i>
            </button>
            {showMenu && (
              <div className={styles.menuDropdown}>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    onToggleMenu();
                    onToggleSettings();
                  }}
                >
                  <i className="fas fa-cog"></i>
                  <span>Chat Settings</span>
                </button>
                {conversationId && (
                  <button
                    type="button"
                    className={`${styles.menuItem} ${styles.danger}`}
                    onClick={() => {
                      onToggleMenu();
                      onDeleteConversation();
                    }}
                  >
                    <i className="fas fa-trash"></i>
                    <span>Delete Conversation</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <button type="submit" disabled={isLoading || !value.trim()}>
            <i className="fas fa-paper-plane"></i>
          </button>
        </div>
      </form>

      <SettingsDialog
        isOpen={showSettings}
        sourceCount={sourceCount}
        useUploaded={useUploaded}
        useSynced={useSynced}
        usePaperless={usePaperless}
        useGoodreads={useGoodreads}
        conversationId={conversationId}
        isSaving={isSaving}
        onClose={onToggleSettings}
        onSourceCountChange={onSourceCountChange}
        onToggleUploaded={onToggleUploaded}
        onToggleSynced={onToggleSynced}
        onTogglePaperless={onTogglePaperless}
        onToggleGoodreads={onToggleGoodreads}
        onSaveConversation={onSaveConversation}
        onDeleteConversation={onDeleteConversation}
      />
    </>
  );
}
