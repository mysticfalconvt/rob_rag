"use client";

import Card from "./Card";
import styles from "./PortainerConfiguration.module.css";

interface PortainerConfigurationProps {
  portainerUrl: string;
  portainerEndpointId: number;
  portainerApiKey: string;
  portainerEnabled: boolean;
  portainerConfigured: boolean;
  isTesting: boolean;
  isSaving: boolean;
  onUrlChange: (url: string) => void;
  onEndpointIdChange: (id: number) => void;
  onApiKeyChange: (key: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onTest: () => void;
  onSave: () => void;
}

export default function PortainerConfiguration({
  portainerUrl,
  portainerEndpointId,
  portainerApiKey,
  portainerEnabled,
  portainerConfigured,
  isTesting,
  isSaving,
  onUrlChange,
  onEndpointIdChange,
  onApiKeyChange,
  onEnabledChange,
  onTest,
  onSave,
}: PortainerConfigurationProps) {
  return (
    <Card title="Portainer / Docker Configuration">
      <div className={styles.formGroup}>
        <label htmlFor="portainerUrl">Portainer URL</label>
        <input
          id="portainerUrl"
          type="text"
          value={portainerUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="http://tower.local:9000"
          className={styles.input}
          disabled={isSaving}
        />
        <small className={styles.helpText}>
          URL of your Portainer instance (e.g., http://tower.local:9000)
        </small>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="portainerApiKey">API Key</label>
        <input
          id="portainerApiKey"
          type="password"
          value={portainerApiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder={portainerConfigured ? "••••••••" : "Enter Portainer API key"}
          className={styles.input}
          disabled={isSaving}
        />
        <small className={styles.helpText}>
          Generate in Portainer: My Account → Access Tokens
        </small>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="portainerEndpointId">Endpoint ID</label>
        <input
          id="portainerEndpointId"
          type="number"
          value={portainerEndpointId}
          onChange={(e) => onEndpointIdChange(parseInt(e.target.value) || 1)}
          min={1}
          className={styles.input}
          disabled={isSaving}
        />
        <small className={styles.helpText}>
          Portainer endpoint ID (usually 1 for single-host setups)
        </small>
      </div>

      <div className={styles.formGroup}>
        <label>
          <input
            type="checkbox"
            checked={portainerEnabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            disabled={isSaving}
          />{" "}
          Enable Docker/Portainer Integration
        </label>
      </div>

      <div className={styles.buttonGroup}>
        <button
          onClick={onTest}
          disabled={!portainerUrl || isTesting}
          className={styles.testButton}
        >
          {isTesting ? "Testing..." : "Test Connection"}
        </button>
        <button
          onClick={onSave}
          disabled={isSaving}
          className={styles.saveButton}
        >
          {isSaving ? "Saving..." : "Save Portainer Settings"}
        </button>
      </div>
    </Card>
  );
}
