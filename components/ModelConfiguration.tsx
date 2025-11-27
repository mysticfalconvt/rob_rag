"use client";

import Card from "./Card";
import styles from "./ModelConfiguration.module.css";

interface Settings {
  embeddingModel: string;
  chatModel: string;
  fastChatModel?: string | null;
  isDefault?: boolean;
}

interface ModelConfigurationProps {
  settings: Settings | null;
  embeddingModels: string[];
  chatModels: string[];
  selectedEmbeddingModel: string;
  selectedChatModel: string;
  selectedFastChatModel: string;
  isSaving: boolean;
  hasChanges: boolean;
  onEmbeddingModelChange: (model: string) => void;
  onChatModelChange: (model: string) => void;
  onFastChatModelChange: (model: string) => void;
  onSave: () => void;
}

export default function ModelConfiguration({
  settings,
  embeddingModels,
  chatModels,
  selectedEmbeddingModel,
  selectedChatModel,
  selectedFastChatModel,
  isSaving,
  hasChanges,
  onEmbeddingModelChange,
  onChatModelChange,
  onFastChatModelChange,
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
        <label htmlFor="chatModel">Main Chat Model</label>
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
        <p className={styles.helpText}>
          Used for generating final responses to user queries
        </p>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="fastChatModel">
          Fast Chat Model
          <span className={styles.optional}>(Optional)</span>
        </label>
        <select
          id="fastChatModel"
          value={selectedFastChatModel}
          onChange={(e) => onFastChatModelChange(e.target.value)}
          className={styles.select}
          disabled={isSaving}
        >
          <option value="">Use Main Model</option>
          {chatModels.map((model: string) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <p className={styles.helpText}>
          Used for auxiliary tasks (query rephrasing, title generation, topic
          extraction). Leave empty to use main model.
        </p>
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
