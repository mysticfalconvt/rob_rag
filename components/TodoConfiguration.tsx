"use client";

import { useEffect, useState } from "react";
import Card from "./Card";
import styles from "./PortainerConfiguration.module.css";

interface TodoAccountRow {
  id: string;
  label: string;
  enabled: boolean;
  tokenPreview: string;
}

interface TodoConfigurationProps {
  todoBaseUrl: string;
  todoEnabled: boolean;
  isTesting: boolean;
  isSaving: boolean;
  onBaseUrlChange: (url: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onTest: () => void;
  onSave: () => void;
}

export default function TodoConfiguration({
  todoBaseUrl,
  todoEnabled,
  isTesting,
  isSaving,
  onBaseUrlChange,
  onEnabledChange,
  onTest,
  onSave,
}: TodoConfigurationProps) {
  const [accounts, setAccounts] = useState<TodoAccountRow[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newToken, setNewToken] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchAccounts = async () => {
    try {
      const res = await fetch("/api/todo/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (error) {
      console.error("Error fetching todo accounts:", error);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const addAccount = async () => {
    if (!newLabel.trim() || !newToken.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/todo/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newLabel.trim(),
          apiToken: newToken.trim(),
        }),
      });
      if (res.ok) {
        setNewLabel("");
        setNewToken("");
        await fetchAccounts();
      } else {
        alert("Failed to add member token");
      }
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (id: string) => {
    if (!confirm("Remove this member's token?")) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/todo/accounts?id=${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      );
      if (res.ok) await fetchAccounts();
      else alert("Failed to remove member token");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Todo XP Configuration (read-only)">
      <div className={styles.formGroup}>
        <label htmlFor="todoBaseUrl">Base URL</label>
        <input
          id="todoBaseUrl"
          type="text"
          value={todoBaseUrl}
          onChange={(e) => onBaseUrlChange(e.target.value)}
          placeholder="https://todo.rboskind.com"
          className={styles.input}
          disabled={isSaving}
        />
        <small className={styles.helpText}>
          Base URL of your Todo XP instance.
        </small>
      </div>

      <div className={styles.formGroup}>
        <label>
          <input
            type="checkbox"
            checked={todoEnabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            disabled={isSaving}
          />{" "}
          Enable Todo XP Integration
        </label>
      </div>

      <div className={styles.formGroup}>
        <label>Family member API tokens</label>
        <small className={styles.helpText}>
          Each member mints a token in Todo XP (Settings → API tokens) and you
          add it here. The label is how you'll refer to that person.
        </small>
        {accounts.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0" }}>
            {accounts.map((a) => (
              <li
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.25rem 0",
                }}
              >
                <span style={{ flex: 1 }}>
                  <strong>{a.label}</strong>{" "}
                  <code style={{ opacity: 0.7 }}>{a.tokenPreview}</code>
                  {!a.enabled && " (disabled)"}
                </span>
                <button
                  type="button"
                  onClick={() => removeAccount(a.id)}
                  disabled={busy}
                  className={styles.testButton}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Member name (e.g. Rob)"
            className={styles.input}
            disabled={busy}
          />
          <input
            type="password"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder="tgx_… API token"
            className={styles.input}
            disabled={busy}
          />
          <button
            type="button"
            onClick={addAccount}
            disabled={busy || !newLabel.trim() || !newToken.trim()}
            className={styles.saveButton}
          >
            Add
          </button>
        </div>
      </div>

      <div className={styles.buttonGroup}>
        <button
          onClick={onTest}
          disabled={isTesting}
          className={styles.testButton}
          type="button"
        >
          {isTesting ? "Testing..." : "Test Connection"}
        </button>
        <button
          onClick={onSave}
          disabled={isSaving}
          className={styles.saveButton}
          type="button"
        >
          {isSaving ? "Saving..." : "Save Todo XP Settings"}
        </button>
      </div>
    </Card>
  );
}
