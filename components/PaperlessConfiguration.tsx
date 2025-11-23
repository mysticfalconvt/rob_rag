"use client";

import Card from "./Card";
import styles from "./PaperlessConfiguration.module.css";

interface PaperlessConfigurationProps {
  paperlessUrl: string;
  paperlessExternalUrl: string;
  paperlessApiToken: string;
  paperlessEnabled: boolean;
  paperlessConfigured: boolean;
  isTesting: boolean;
  isSaving: boolean;
  onUrlChange: (url: string) => void;
  onExternalUrlChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onTest: () => void;
  onSave: () => void;
}

export default function PaperlessConfiguration({
  paperlessUrl,
  paperlessExternalUrl,
  paperlessApiToken,
  paperlessEnabled,
  paperlessConfigured,
  isTesting,
  isSaving,
  onUrlChange,
  onExternalUrlChange,
  onTokenChange,
  onEnabledChange,
  onTest,
  onSave,
}: PaperlessConfigurationProps) {
  return (
    <Card title="Paperless-ngx Configuration">

      <div className={styles.formGroup}>
        <label htmlFor="paperlessUrl">Paperless-ngx API URL</label>
        <input
          id="paperlessUrl"
          type="text"
          value={paperlessUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="http://localhost:8000"
          className={styles.input}
          disabled={isSaving}
        />
        <small className={styles.helpText}>
          Internal URL for API connections
        </small>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="paperlessExternalUrl">External URL (Optional)</label>
        <input
          id="paperlessExternalUrl"
          type="text"
          value={paperlessExternalUrl}
          onChange={(e) => onExternalUrlChange(e.target.value)}
          placeholder="https://paperless.example.com"
          className={styles.input}
          disabled={isSaving}
        />
        <small className={styles.helpText}>
          Public URL for browser links (leave empty to use API URL)
        </small>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="paperlessApiToken">API Token</label>
        <input
          id="paperlessApiToken"
          type="password"
          value={paperlessApiToken}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder={paperlessConfigured ? "••••••••" : "Enter API token"}
          className={styles.input}
          disabled={isSaving}
        />
      </div>

      <div className={styles.formGroup}>
        <label>
          <input
            type="checkbox"
            checked={paperlessEnabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            disabled={isSaving}
          />{" "}
          Enable Paperless-ngx Integration
        </label>
      </div>

      <div className={styles.buttonGroup}>
        <button
          onClick={onTest}
          disabled={!paperlessUrl || isTesting}
          className={styles.testButton}
        >
          {isTesting ? "Testing..." : "Test Connection"}
        </button>
        <button
          onClick={onSave}
          disabled={isSaving}
          className={styles.saveButton}
        >
          {isSaving ? "Saving..." : "Save Paperless Settings"}
        </button>
      </div>
    </Card>
  );
}
