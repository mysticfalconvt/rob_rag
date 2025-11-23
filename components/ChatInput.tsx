"use client";

import styles from "./ChatInput.module.css";

interface ChatInputProps {
  value: string;
  isLoading: boolean;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export default function ChatInput({
  value,
  isLoading,
  onChange,
  onSubmit,
}: ChatInputProps) {
  return (
    <form onSubmit={onSubmit} className={styles.inputForm}>
      <div className={styles.inputWrapper}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !value.trim()}>
          <i className="fas fa-paper-plane"></i>
        </button>
      </div>
    </form>
  );
}
