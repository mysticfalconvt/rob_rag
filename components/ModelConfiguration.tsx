"use client";

import Card from "./Card";
import styles from "./ModelConfiguration.module.css";

interface Settings {
  embeddingModel: string;
  chatModel: string;
  isDefault?: boolean;
}

interface ModelConfigurationProps {
  settings: Settings | null;
  embeddingModels: string[];
  chatModels: string[];
  selectedEmbeddingModel: string;
  selectedChatModel: string;
  isSaving: boolean;
  hasChanges: boolean;
  onEmbeddingModelChange: (model: string) => void;
  onChatModelChange: (model: string) => void;
  onSave: () => void;
}

export default function ModelConfiguration({
  settings,
  embeddingModels,
  chatModels,
  selectedEmbeddingModel,
  selectedChatModel,
  isSaving,
  hasChanges,
  onEmbeddingModelChange,
  onChatModelChange,
  onSave,
}: ModelConfigurationProps) {
  return (
    <Card
      title="Model Configuration"
      action={
        settings?.isDefault && (
          <span
            className={styles.defaultBadge}
            title="Using environment variables"
          >
            Default
          </span>
        )
      }
    >
      <div className={styles.formGroup}>
        <label htmlFor="embeddingModel">
          Embedding Model
          <span
            className={styles.warningIcon}
            title="Changing this requires re-indexing all files"
          >
            ⚠️
          </span>
        </label>
        <select
          id="embeddingModel"
          value={selectedEmbeddingModel}
          onChange={(e) => onEmbeddingModelChange(e.target.value)}
          className={styles.select}
          disabled={isSaving}
        >
          {embeddingModels.length === 0 ? (
            <option>{settings?.embeddingModel || "Loading..."}</option>
          ) : (
            embeddingModels.map((model: string) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))
          )}
        </select>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="chatModel">Chat Model</label>
        <select
          id="chatModel"
          value={selectedChatModel}
          onChange={(e) => onChatModelChange(e.target.value)}
          className={styles.select}
          disabled={isSaving}
        >
          {chatModels.length === 0 ? (
            <option>{settings?.chatModel || "Loading..."}</option>
          ) : (
            chatModels.map((model: string) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))
          )}
        </select>
      </div>

      <button
        onClick={onSave}
        disabled={!hasChanges || isSaving}
        className={styles.saveButton}
      >
        {isSaving ? "Saving..." : "Save Settings"}
      </button>
    </Card>
  );
}
