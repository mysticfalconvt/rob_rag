"use client";

import { useState, useEffect } from "react";
import { DEFAULT_PROMPTS } from "@/lib/prompts";
import Toast from "@/components/Toast";
import styles from "./PromptConfiguration.module.css";

interface PromptConfigurationProps {
  onSaveSuccess?: () => void;
}

export default function PromptConfiguration({
  onSaveSuccess,
}: PromptConfigurationProps) {
  const [prompts, setPrompts] = useState({
    ragSystemPrompt: "",
    noSourcesSystemPrompt: "",
    titleGenerationPrompt: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({
    rag: false,
    noSources: false,
    title: false,
  });
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    fetchPrompts();
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

  const fetchPrompts = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/prompts");
      if (response.ok) {
        const data = await response.json();
        setPrompts(data);
      }
    } catch (error) {
      console.error("Failed to fetch prompts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePrompt = async (promptKey: keyof typeof prompts) => {
    const savingKey =
      promptKey === "ragSystemPrompt"
        ? "rag"
        : promptKey === "noSourcesSystemPrompt"
          ? "noSources"
          : "title";

    setSaving((prev) => ({ ...prev, [savingKey]: true }));
    try {
      const response = await fetch("/api/settings/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [promptKey]: prompts[promptKey] }),
      });
      if (response.ok) {
        setToast({
          message: "Prompt saved successfully!",
          type: "success",
        });
        onSaveSuccess?.();
      } else {
        throw new Error("Failed to save prompt");
      }
    } catch (error) {
      console.error("Failed to save prompt:", error);
      setToast({
        message: "Failed to save prompt",
        type: "error",
      });
    } finally {
      setSaving((prev) => ({ ...prev, [savingKey]: false }));
    }
  };

  const handleResetPrompt = (promptKey: keyof typeof prompts) => {
    if (
      confirm(
        "Are you sure you want to reset this prompt to its default value?",
      )
    ) {
      setPrompts((prev) => ({
        ...prev,
        [promptKey]: DEFAULT_PROMPTS[promptKey],
      }));
    }
  };

  if (loading) {
    return (
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Prompt Configuration</h2>
        <div className={styles.loading}>Loading prompts...</div>
      </div>
    );
  }

  return (
    <>
      {/* RAG System Prompt Card */}
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>RAG System Prompt</h2>
            <p className={styles.subtitle}>Used when documents are retrieved</p>
          </div>
          <div className={styles.buttonGroup}>
            <button
              onClick={() => handleResetPrompt("ragSystemPrompt")}
              className={styles.resetButton}
              disabled={loading || saving.rag}
            >
              Reset
            </button>
            <button
              onClick={() => handleSavePrompt("ragSystemPrompt")}
              className={styles.saveButton}
              disabled={loading || saving.rag}
            >
              {saving.rag ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
        <p className={styles.description}>
          Use <code>{"{{context}}"}</code> to insert document context.
        </p>
        <textarea
          id="ragSystemPrompt"
          value={prompts.ragSystemPrompt}
          onChange={(e) =>
            setPrompts((prev) => ({
              ...prev,
              ragSystemPrompt: e.target.value,
            }))
          }
          className={styles.textarea}
          rows={8}
        />
      </div>

      {/* No Sources System Prompt Card */}
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>No Sources System Prompt</h2>
            <p className={styles.subtitle}>Used in chat-only mode</p>
          </div>
          <div className={styles.buttonGroup}>
            <button
              onClick={() => handleResetPrompt("noSourcesSystemPrompt")}
              className={styles.resetButton}
              disabled={loading || saving.noSources}
            >
              Reset
            </button>
            <button
              onClick={() => handleSavePrompt("noSourcesSystemPrompt")}
              className={styles.saveButton}
              disabled={loading || saving.noSources}
            >
              {saving.noSources ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
        <p className={styles.description}>
          Used when no document context is needed.
        </p>
        <textarea
          id="noSourcesSystemPrompt"
          value={prompts.noSourcesSystemPrompt}
          onChange={(e) =>
            setPrompts((prev) => ({
              ...prev,
              noSourcesSystemPrompt: e.target.value,
            }))
          }
          className={styles.textarea}
          rows={4}
        />
      </div>

      {/* Title Generation Prompt Card */}
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>Title Generation Prompt</h2>
            <p className={styles.subtitle}>
              Used to generate conversation titles
            </p>
          </div>
          <div className={styles.buttonGroup}>
            <button
              onClick={() => handleResetPrompt("titleGenerationPrompt")}
              className={styles.resetButton}
              disabled={loading || saving.title}
            >
              Reset
            </button>
            <button
              onClick={() => handleSavePrompt("titleGenerationPrompt")}
              className={styles.saveButton}
              disabled={loading || saving.title}
            >
              {saving.title ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
        <p className={styles.description}>
          Use <code>{"{{userMessage}}"}</code> and{" "}
          <code>{"{{assistantMessage}}"}</code> placeholders.
        </p>
        <textarea
          id="titleGenerationPrompt"
          value={prompts.titleGenerationPrompt}
          onChange={(e) =>
            setPrompts((prev) => ({
              ...prev,
              titleGenerationPrompt: e.target.value,
            }))
          }
          className={styles.textarea}
          rows={6}
        />
      </div>

      {/* Toast notification */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  );
}
