"use client";

import { useState } from "react";
import styles from "./BulkTagGeneration.module.css";

interface BulkTagGenerationProps {
  onComplete?: () => void;
}

export default function BulkTagGeneration({
  onComplete,
}: BulkTagGenerationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [source, setSource] = useState<string>("all");
  const [onlyUntagged, setOnlyUntagged] = useState(true);
  const [result, setResult] = useState<any>(null);

  const handleGenerate = async () => {
    if (
      !confirm(
        `Generate tags for ${source === "all" ? "all" : source} documents${onlyUntagged ? " (untagged only)" : ""}?\n\n` +
          `This will use the LLM to generate tags for each document. ` +
          `This may take several minutes depending on the number of documents.\n\n` +
          `Generated tags will start as "pending" and can be approved in the Tags page.`,
      )
    ) {
      return;
    }

    setIsGenerating(true);
    setResult(null);

    try {
      const res = await fetch("/api/tags/bulk-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, onlyUntagged }),
      });

      if (res.ok) {
        const data = await res.json();
        setResult(data);
        onComplete?.();
      } else {
        const error = await res.json();
        alert(`Failed to generate tags: ${error.error || error.details}`);
      }
    } catch (error) {
      console.error("Error generating tags:", error);
      alert("Failed to generate tags");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={styles.container}>
      <button
        className={styles.toggleButton}
        onClick={() => setIsOpen(!isOpen)}
      >
        <i className="fas fa-magic"></i>
        Bulk Generate Tags
        <i className={`fas fa-chevron-${isOpen ? "up" : "down"}`}></i>
      </button>

      {isOpen && (
        <div className={styles.panel}>
          <div className={styles.options}>
            <div className={styles.option}>
              <label htmlFor="source-select">Document Source:</label>
              <select
                id="source-select"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={styles.select}
                disabled={isGenerating}
              >
                <option value="all">All Sources</option>
                <option value="uploaded">Uploaded</option>
                <option value="synced">Synced</option>
                <option value="local">Local</option>
                <option value="paperless">Paperless</option>
                <option value="custom_ocr">Custom OCR</option>
                <option value="goodreads">Goodreads</option>
              </select>
            </div>

            <div className={styles.option}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={onlyUntagged}
                  onChange={(e) => setOnlyUntagged(e.target.checked)}
                  disabled={isGenerating}
                />
                <span>Only generate for untagged documents</span>
              </label>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className={styles.generateButton}
          >
            {isGenerating ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Generating Tags...
              </>
            ) : (
              <>
                <i className="fas fa-play"></i>
                Start Generation
              </>
            )}
          </button>

          {result && (
            <div className={styles.result}>
              <h4>
                <i className="fas fa-check-circle"></i>
                Generation Complete
              </h4>
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Total Files:</span>
                  <span className={styles.statValue}>{result.totalFiles}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Successfully Tagged:</span>
                  <span className={styles.statValue}>{result.tagged}</span>
                </div>
                {result.skipped > 0 && (
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>Skipped (missing files):</span>
                    <span className={styles.statValue}>{result.skipped}</span>
                  </div>
                )}
                {result.errors > 0 && (
                  <div className={styles.stat}>
                    <span className={styles.statLabel}>Errors:</span>
                    <span className={`${styles.statValue} ${styles.error}`}>
                      {result.errors}
                    </span>
                  </div>
                )}
              </div>
              <p className={styles.message}>{result.message}</p>
              {result.tagged > 0 && (
                <p className={styles.hint}>
                  <i className="fas fa-info-circle"></i>
                  New tags have been created as "pending". Review and approve
                  them in the <a href="/tags">Tags page</a>.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
