"use client";

import { useState, useEffect } from "react";
import Toast from "@/components/Toast";
import styles from "./ContextWindowSettings.module.css";

export default function ContextWindowSettings() {
  const [maxContextTokens, setMaxContextTokens] = useState(8000);
  const [contextStrategy, setContextStrategy] = useState<
    "sliding" | "token" | "smart"
  >("smart");
  const [slidingWindowSize, setSlidingWindowSize] = useState(10);
  const [enableContextSummary, setEnableContextSummary] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/context");
      if (response.ok) {
        const data = await response.json();
        setMaxContextTokens(data.maxContextTokens);
        setContextStrategy(data.contextStrategy);
        setSlidingWindowSize(data.slidingWindowSize);
        setEnableContextSummary(data.enableContextSummary);
      }
    } catch (error) {
      console.error("Failed to fetch context settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxContextTokens,
          contextStrategy,
          slidingWindowSize,
          enableContextSummary,
        }),
      });
      if (response.ok) {
        setToast({
          message: "Context settings saved successfully!",
          type: "success",
        });
      } else {
        throw new Error("Failed to save settings");
      }
    } catch (error) {
      console.error("Failed to save context settings:", error);
      setToast({
        message: "Failed to save context settings",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Context Window Management</h2>
        <div className={styles.loading}>Loading settings...</div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>Context Window Management</h2>
            <p className={styles.subtitle}>
              Control how conversation history is handled
            </p>
          </div>
          <button
            onClick={handleSave}
            className={styles.saveButton}
            disabled={loading || saving}
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>

        <div className={styles.field}>
          <label htmlFor="contextStrategy" className={styles.label}>
            Context Strategy
          </label>
          <p className={styles.description}>
            Choose how to manage long conversations to prevent token overflow.
          </p>
          <select
            id="contextStrategy"
            value={contextStrategy}
            onChange={(e) =>
              setContextStrategy(
                e.target.value as "sliding" | "token" | "smart",
              )
            }
            className={styles.select}
          >
            <option value="smart">
              Smart (Recent messages + Summary of older ones)
            </option>
            <option value="sliding">
              Sliding Window (Keep last N messages)
            </option>
            <option value="token">Token-Based (Fit within token budget)</option>
          </select>
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor="maxContextTokens" className={styles.label}>
              Max Context Tokens
            </label>
            <span className={styles.valueDisplay}>{maxContextTokens}</span>
          </div>
          <p className={styles.description}>
            Maximum tokens to use for conversation history. Typical models:
            GPT-3.5 (4k-8k), GPT-4/Llama (8k-16k), Claude (8k-50k).
          </p>
          <input
            id="maxContextTokens"
            type="range"
            min="2000"
            max="32000"
            step="1000"
            value={maxContextTokens}
            onChange={(e) => setMaxContextTokens(Number(e.target.value))}
            className={styles.slider}
          />
          <div className={styles.sliderLabels}>
            <span>2k</span>
            <span>32k</span>
          </div>
        </div>

        {(contextStrategy === "sliding" || contextStrategy === "smart") && (
          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label htmlFor="slidingWindowSize" className={styles.label}>
                Recent Messages to Keep
              </label>
              <span className={styles.valueDisplay}>{slidingWindowSize}</span>
            </div>
            <p className={styles.description}>
              Number of recent messages to keep in full detail
              {contextStrategy === "smart"
                ? " (older messages will be summarized)"
                : ""}.
            </p>
            <input
              id="slidingWindowSize"
              type="range"
              min="5"
              max="30"
              step="1"
              value={slidingWindowSize}
              onChange={(e) => setSlidingWindowSize(Number(e.target.value))}
              className={styles.slider}
            />
            <div className={styles.sliderLabels}>
              <span>5</span>
              <span>30</span>
            </div>
          </div>
        )}

        {contextStrategy === "smart" && (
          <div className={styles.field}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={enableContextSummary}
                onChange={(e) => setEnableContextSummary(e.target.checked)}
                className={styles.checkbox}
              />
              <span>
                Enable conversation summarization for older messages
              </span>
            </label>
            <p className={styles.description}>
              When enabled, older messages are summarized to save tokens while
              preserving important context.
            </p>
          </div>
        )}

        <div className={styles.infoBox}>
          <i className="fas fa-info-circle"></i>
          <div>
            <strong>How it works:</strong>
            <ul>
              <li>
                <strong>Smart Strategy (Recommended):</strong> Keeps recent
                messages in full + summarizes older ones. Best balance of
                context and efficiency.
              </li>
              <li>
                <strong>Sliding Window:</strong> Simple approach that keeps only
                the last N messages. Fast but may lose important context.
              </li>
              <li>
                <strong>Token-Based:</strong> Keeps as many recent messages as
                fit within your token budget. Precise but no summarization.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  );
}
