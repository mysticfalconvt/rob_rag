"use client";

import Card from "./Card";
import styles from "./PortainerConfiguration.module.css";

interface GithubConfigurationProps {
  githubToken: string;
  githubEnabled: boolean;
  githubConfigured: boolean;
  isTesting: boolean;
  isSaving: boolean;
  onTokenChange: (token: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onTest: () => void;
  onSave: () => void;
}

export default function GithubConfiguration({
  githubToken,
  githubEnabled,
  githubConfigured,
  isTesting,
  isSaving,
  onTokenChange,
  onEnabledChange,
  onTest,
  onSave,
}: GithubConfigurationProps) {
  return (
    <Card title="GitHub Configuration (read-only)">
      <div className={styles.formGroup}>
        <label htmlFor="githubToken">Personal Access Token</label>
        <input
          id="githubToken"
          type="password"
          value={githubToken}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder={
            githubConfigured ? "••••••••" : "ghp_… (classic PAT, repo scope)"
          }
          className={styles.input}
          disabled={isSaving}
        />
        <small className={styles.helpText}>
          Use a <strong>classic</strong> token with the <code>repo</code> scope
          (GitHub → Settings → Developer settings → Personal access tokens →
          Tokens (classic)). For org repos, authorize it for SSO.
        </small>
      </div>

      <div className={styles.formGroup}>
        <label>
          <input
            type="checkbox"
            checked={githubEnabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            disabled={isSaving}
          />{" "}
          Enable GitHub Integration
        </label>
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
          {isSaving ? "Saving..." : "Save GitHub Settings"}
        </button>
      </div>
    </Card>
  );
}
