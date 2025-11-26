"use client";

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
  sourceCount: number;
  showSettings: boolean;
  useUploaded: boolean;
  useSynced: boolean;
  usePaperless: boolean;
  goodreadsUsers: GoodreadsUser[];
  conversationId: string | null;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onSourceCountChange: (count: number) => void;
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
  sourceCount,
  showSettings,
  useUploaded,
  useSynced,
  usePaperless,
  goodreadsUsers,
  conversationId,
  isSaving,
  onChange,
  onSubmit,
  onSourceCountChange,
  onToggleSettings,
  onToggleUploaded,
  onToggleSynced,
  onTogglePaperless,
  onToggleGoodreadsUser,
  onSaveConversation,
  onDeleteConversation,
}: ChatInputProps) {
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
          <button
            type="button"
            className={styles.menuButton}
            onClick={onToggleSettings}
            title="Settings"
          >
            <i className="fas fa-cog"></i>
          </button>
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
        goodreadsUsers={goodreadsUsers}
        conversationId={conversationId}
        isSaving={isSaving}
        onClose={onToggleSettings}
        onSourceCountChange={onSourceCountChange}
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
