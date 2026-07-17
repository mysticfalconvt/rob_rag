"use client";

import { useEffect, useRef } from "react";
import styles from "./ChatInput.module.css";
import SettingsDialog from "./SettingsDialog";

interface GoodreadsUser {
  id: string;
  name: string;
  enabled: boolean;
}

interface ChatInputProps {
  value: string;
  isLoading: boolean;
  showSettings: boolean;
  useUploaded: boolean;
  useSynced: boolean;
  usePaperless: boolean;
  goodreadsUsers: GoodreadsUser[];
  conversationId: string | null;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  onToggleSettings: () => void;
  onToggleUploaded: () => void;
  onToggleSynced: () => void;
  onTogglePaperless: () => void;
  onToggleGoodreadsUser: (userId: string) => void;
  onSaveConversation: () => void;
  onDeleteConversation: () => void;
}

export default function ChatInput({
  value,
  isLoading,
  showSettings,
  useUploaded,
  useSynced,
  usePaperless,
  goodreadsUsers,
  conversationId,
  isSaving,
  onChange,
  onSubmit,
  onCancel,
  onToggleSettings,
  onToggleUploaded,
  onToggleSynced,
  onTogglePaperless,
  onToggleGoodreadsUser,
  onSaveConversation,
  onDeleteConversation,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [value]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && value.trim()) {
        handleSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <div className={styles.inputWrapper}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isLoading
                ? "Type your next message… (send once the reply finishes)"
                : "Type your message... (Shift+Enter for newline)"
            }
            rows={1}
            className={styles.textarea}
          />
          <button
            type="button"
            className={styles.menuButton}
            onClick={onToggleSettings}
            title="Settings"
          >
            <i className="fas fa-cog"></i>
          </button>
          {isLoading ? (
            <button
              type="button"
              onClick={onCancel}
              className={styles.stopButton}
              title="Stop generation"
            >
              <i className="fas fa-stop"></i>
            </button>
          ) : (
            <button type="submit" disabled={!value.trim()} title="Send">
              <i className="fas fa-paper-plane"></i>
            </button>
          )}
        </div>
      </form>

      <SettingsDialog
        isOpen={showSettings}
        useUploaded={useUploaded}
        useSynced={useSynced}
        usePaperless={usePaperless}
        goodreadsUsers={goodreadsUsers}
        conversationId={conversationId}
        isSaving={isSaving}
        onClose={onToggleSettings}
        onToggleUploaded={onToggleUploaded}
        onToggleSynced={onToggleSynced}
        onTogglePaperless={onTogglePaperless}
        onToggleGoodreadsUser={onToggleGoodreadsUser}
        onSaveConversation={onSaveConversation}
        onDeleteConversation={onDeleteConversation}
      />
    </>
  );
}
