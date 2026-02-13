"use client";

import { useState } from "react";
import Card from "./Card";
import styles from "./ModelConfiguration.module.css";

interface PaperlessSyncSettings {
  paperlessSyncEnabled: boolean;
  paperlessSyncInterval: number; // minutes
  paperlessSyncLastRun: Date | null;
  paperlessSyncFilters: {
    tags?: string[];
    minDate?: string; // ISO date string
    maxDate?: string;
  } | null;
  paperlessAutoOcr: boolean;
}

interface PaperlessSyncConfigProps {
  settings: PaperlessSyncSettings;
  paperlessEnabled: boolean;
  onSave: (settings: Partial<PaperlessSyncSettings>) => Promise<void>;
  onSyncNow: () => Promise<void>;
  isSaving: boolean;
  isSyncing: boolean;
}

export default function PaperlessSyncConfig({
  settings,
  paperlessEnabled,
  onSave,
  onSyncNow,
  isSaving,
  isSyncing,
}: PaperlessSyncConfigProps) {
  const [syncEnabled, setSyncEnabled] = useState(settings.paperlessSyncEnabled);
  const [syncInterval, setSyncInterval] = useState(settings.paperlessSyncInterval);
  const [autoOcr, setAutoOcr] = useState(settings.paperlessAutoOcr);

  const filters = settings.paperlessSyncFilters || {};
  const [filterTags, setFilterTags] = useState<string>(
    (filters.tags || []).join(", ")
  );
  const [filterMinDate, setFilterMinDate] = useState<string>(
    filters.minDate || ""
  );

  const handleSave = async () => {
    const newFilters = {
      tags: filterTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
      minDate: filterMinDate || undefined,
    };

    await onSave({
      paperlessSyncEnabled: syncEnabled,
      paperlessSyncInterval: syncInterval,
      paperlessSyncFilters: newFilters,
      paperlessAutoOcr: autoOcr,
    });
  };

  if (!paperlessEnabled) {
    return (
      <Card title="Paperless Auto-Sync">
        <p style={{ color: "#666" }}>
          Paperless-ngx integration must be enabled and configured first.
          Please configure Paperless in the section above.
        </p>
      </Card>
    );
  }

  const lastRunText = settings.paperlessSyncLastRun
    ? new Date(settings.paperlessSyncLastRun).toLocaleString()
    : "Never";

  const intervalOptions = [
    { value: 15, label: "Every 15 minutes" },
    { value: 30, label: "Every 30 minutes" },
    { value: 60, label: "Every hour" },
    { value: 120, label: "Every 2 hours" },
    { value: 360, label: "Every 6 hours" },
    { value: 720, label: "Every 12 hours" },
    { value: 1440, label: "Daily" },
  ];

  return (
    <Card title="Paperless Auto-Sync">
      <p style={{ marginBottom: "1rem", color: "#666", fontSize: "0.9rem" }}>
        Automatically import new and updated documents from Paperless-ngx.
      </p>

      <div className={styles.formGroup}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={syncEnabled}
            onChange={(e) => setSyncEnabled(e.target.checked)}
            disabled={isSaving}
          />
          <span>Enable Automatic Sync</span>
        </label>
        <p className={styles.helpText}>
          When enabled, new documents will be automatically imported from Paperless.
        </p>
      </div>

      {syncEnabled && (
        <>
          <div className={styles.formGroup}>
            <label htmlFor="syncInterval">Sync Interval</label>
            <select
              id="syncInterval"
              value={syncInterval}
              onChange={(e) => setSyncInterval(parseInt(e.target.value))}
              className={styles.input}
              disabled={isSaving}
            >
              {intervalOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className={styles.helpText}>
              How often to check for new documents.
            </p>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="filterTags">Filter by Tags (optional)</label>
            <input
              id="filterTags"
              type="text"
              value={filterTags}
              onChange={(e) => setFilterTags(e.target.value)}
              className={styles.input}
              placeholder="important, invoices, contracts"
              disabled={isSaving}
            />
            <p className={styles.helpText}>
              Only sync documents with these tags. Leave empty to sync all documents.
            </p>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="filterMinDate">Only documents added after</label>
            <input
              id="filterMinDate"
              type="date"
              value={filterMinDate}
              onChange={(e) => setFilterMinDate(e.target.value)}
              className={styles.input}
              disabled={isSaving}
            />
            <p className={styles.helpText}>
              Only sync documents added to Paperless after this date. Leave empty for all documents.
            </p>
          </div>

          <div className={styles.formGroup}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={autoOcr}
                onChange={(e) => setAutoOcr(e.target.checked)}
                disabled={isSaving}
              />
              <span>Auto-OCR New Documents</span>
            </label>
            <p className={styles.helpText}>
              Automatically run custom OCR on newly imported Paperless documents.
              Requires custom OCR to be enabled above.
            </p>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginTop: "1rem" }}>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={styles.saveButton}
        >
          {isSaving ? "Saving..." : "Save Configuration"}
        </button>

        <button
          onClick={onSyncNow}
          disabled={isSyncing}
          className={styles.saveButton}
          style={{ backgroundColor: "#3b82f6" }}
        >
          {isSyncing ? (
            <>
              <i className="fas fa-spinner fa-spin"></i> Syncing...
            </>
          ) : (
            <>
              <i className="fas fa-sync"></i> Sync Now
            </>
          )}
        </button>
      </div>

      <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
        <strong>Last sync:</strong> {lastRunText}
      </div>

      {syncEnabled && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#666" }}>
          <strong>Note:</strong> Auto-sync runs in the background. You can also manually trigger a sync using the "Sync Now" button.
        </div>
      )}
    </Card>
  );
}
