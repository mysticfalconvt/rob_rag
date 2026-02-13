"use client";

import { useState } from "react";
import Card from "./Card";
import styles from "./ModelConfiguration.module.css";

interface SyncedFilesConfig {
  excludeDirs: string[];
  includeExtensions: string[];
  excludeExtensions: string[];
  maxFileSizeBytes: number;
  excludePathPatterns?: string[];
}

interface SyncedFilesConfigurationProps {
  config: SyncedFilesConfig | null;
  onSave: (config: SyncedFilesConfig) => Promise<void>;
  isSaving: boolean;
}

const DEFAULT_CONFIG: SyncedFilesConfig = {
  excludeDirs: ["node_modules", ".git", ".next", "temp_images", ".archive"],
  includeExtensions: [".md", ".pdf", ".txt", ".docx"],
  excludeExtensions: [],
  maxFileSizeBytes: 10485760, // 10MB
  excludePathPatterns: [],
};

export default function SyncedFilesConfiguration({
  config,
  onSave,
  isSaving,
}: SyncedFilesConfigurationProps) {
  const currentConfig = config || DEFAULT_CONFIG;

  const [excludeDirs, setExcludeDirs] = useState<string>(
    currentConfig.excludeDirs.join(", ")
  );
  const [includeExtensions, setIncludeExtensions] = useState<string>(
    currentConfig.includeExtensions.join(", ")
  );
  const [excludeExtensions, setExcludeExtensions] = useState<string>(
    currentConfig.excludeExtensions.join(", ")
  );
  const [excludePathPatterns, setExcludePathPatterns] = useState<string>(
    (currentConfig.excludePathPatterns || []).join(", ")
  );
  const [maxFileSizeMB, setMaxFileSizeMB] = useState<number>(
    Math.round(currentConfig.maxFileSizeBytes / 1024 / 1024)
  );

  const handleSave = async () => {
    const newConfig: SyncedFilesConfig = {
      excludeDirs: excludeDirs
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d.length > 0),
      includeExtensions: includeExtensions
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0),
      excludeExtensions: excludeExtensions
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0),
      excludePathPatterns: excludePathPatterns
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
      maxFileSizeBytes: maxFileSizeMB * 1024 * 1024,
    };

    await onSave(newConfig);
  };

  return (
    <Card title="Synced Files Configuration">
      <p style={{ marginBottom: "1rem", color: "#666", fontSize: "0.9rem" }}>
        Control which files are indexed from your synced documents folder.
        Changes will apply on the next scan.
      </p>

      <div className={styles.formGroup}>
        <label htmlFor="excludeDirs">Excluded Directories</label>
        <input
          id="excludeDirs"
          type="text"
          value={excludeDirs}
          onChange={(e) => setExcludeDirs(e.target.value)}
          className={styles.input}
          placeholder="node_modules, .git, .next"
          disabled={isSaving}
        />
        <p className={styles.helpText}>
          Comma-separated list of directory names to skip during scanning.
        </p>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="includeExtensions">Include File Extensions</label>
        <input
          id="includeExtensions"
          type="text"
          value={includeExtensions}
          onChange={(e) => setIncludeExtensions(e.target.value)}
          className={styles.input}
          placeholder=".md, .pdf, .txt, .docx"
          disabled={isSaving}
        />
        <p className={styles.helpText}>
          Only index files with these extensions. Leave empty to include all
          supported types.
        </p>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="excludeExtensions">Exclude File Extensions</label>
        <input
          id="excludeExtensions"
          type="text"
          value={excludeExtensions}
          onChange={(e) => setExcludeExtensions(e.target.value)}
          className={styles.input}
          placeholder=".log, .tmp"
          disabled={isSaving}
        />
        <p className={styles.helpText}>
          Skip files with these extensions. Takes priority over include list.
        </p>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="excludePathPatterns">Exclude Path Patterns</label>
        <input
          id="excludePathPatterns"
          type="text"
          value={excludePathPatterns}
          onChange={(e) => setExcludePathPatterns(e.target.value)}
          className={styles.input}
          placeholder="copilot, backup, test"
          disabled={isSaving}
        />
        <p className={styles.helpText}>
          Skip any file or folder whose path contains these patterns (case-insensitive).
          Example: "copilot" will exclude "/path/to/copilot/file.txt" and "/copilot_data/file.md"
        </p>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="maxFileSize">
          Maximum File Size (MB): {maxFileSizeMB}
        </label>
        <input
          id="maxFileSize"
          type="range"
          min="1"
          max="100"
          value={maxFileSizeMB}
          onChange={(e) => setMaxFileSizeMB(parseInt(e.target.value))}
          className={styles.slider}
          disabled={isSaving}
        />
        <p className={styles.helpText}>
          Skip files larger than this size to avoid indexing huge files.
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className={styles.saveButton}
      >
        {isSaving ? "Saving..." : "Save Configuration"}
      </button>

      <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
        <strong>Note:</strong> After changing these settings, run a scan from
        the Status page to apply the changes.
      </div>
    </Card>
  );
}
