"use client";

import Card from "./Card";
import styles from "./ModelConfiguration.module.css";

interface CustomOcrConfigurationProps {
  visionModels: string[];
  selectedVisionModel: string;
  customOcrEnabled: boolean;
  onVisionModelChange: (model: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onSave: () => void;
  isSaving: boolean;
}

export default function CustomOcrConfiguration({
  visionModels,
  selectedVisionModel,
  customOcrEnabled,
  onVisionModelChange,
  onEnabledChange,
  onSave,
  isSaving,
}: CustomOcrConfigurationProps) {
  return (
    <Card title="Custom OCR Configuration">
      <div className={styles.formGroup}>
        <label htmlFor="visionModel">Vision Model</label>
        <select
          id="visionModel"
          value={selectedVisionModel}
          onChange={(e) => onVisionModelChange(e.target.value)}
          className={styles.select}
          disabled={isSaving}
        >
          <option value="">Select a vision model...</option>
          {visionModels.length === 0 ? (
            <option disabled>No vision models available</option>
          ) : (
            visionModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))
          )}
        </select>
        <p className={styles.helpText}>
          Vision models can read images and PDFs. Look for models with
          "vision", "vl", "llava", or "qwen2-vl" in their names.
        </p>
      </div>

      <div className={styles.formGroup}>
        <label>
          <input
            type="checkbox"
            checked={customOcrEnabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            disabled={isSaving}
            style={{ marginRight: "0.5rem" }}
          />
          Enable Custom OCR
        </label>
        <p className={styles.helpText}>
          When enabled, you can use vision OCR on individual Paperless documents
          from the Files page. Better for poor scans, handwriting, and complex
          layouts.
        </p>
      </div>

      <button
        onClick={onSave}
        disabled={isSaving || !selectedVisionModel}
        className={styles.saveButton}
      >
        {isSaving ? "Saving..." : "Save OCR Settings"}
      </button>
    </Card>
  );
}
