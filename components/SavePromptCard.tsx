"use client";

import { useEffect, useState } from "react";
import styles from "./SavePromptCard.module.css";

export interface TriageDraft {
  decision: "memory" | "skill";
  name?: string;
  description?: string;
  body?: string;
  type?: string;
  whenToUse?: string;
}

interface SavePromptCardProps {
  draft: TriageDraft;
  onDismiss: () => void;
  onSaved: (message: string) => void;
}

export default function SavePromptCard({
  draft,
  onDismiss,
  onSaved,
}: SavePromptCardProps) {
  const isSkill = draft.decision === "skill";
  const [name, setName] = useState(draft.name ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [body, setBody] = useState(draft.body ?? "");
  const [meta, setMeta] = useState(
    isSkill ? (draft.whenToUse ?? "") : (draft.type ?? "note"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever a new suggestion arrives.
  useEffect(() => {
    setName(draft.name ?? "");
    setDescription(draft.description ?? "");
    setBody(draft.body ?? "");
    setMeta(isSkill ? (draft.whenToUse ?? "") : (draft.type ?? "note"));
    setError(null);
  }, [draft, isSkill]);

  const handleSave = async () => {
    if (!name.trim() || !body.trim()) {
      setError("Name and body are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const endpoint = isSkill ? "/api/assistant/skills" : "/api/assistant/memory";
      const payload = isSkill
        ? { name, description, whenToUse: meta, body }
        : { name, description, type: meta, body };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      onSaved(`${isSkill ? "Skill" : "Memory"} saved: ${name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.badge}>
          💡 Save as {isSkill ? "skill" : "memory"}?
        </span>
        <button
          className={styles.dismiss}
          onClick={onDismiss}
          disabled={saving}
          title="Dismiss"
        >
          <i className="fas fa-times" />
        </button>
      </div>

      <label className={styles.label}>Name</label>
      <input
        className={styles.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <label className={styles.label}>Description</label>
      <input
        className={styles.input}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label className={styles.label}>{isSkill ? "When to use" : "Type"}</label>
      <input
        className={styles.input}
        value={meta}
        onChange={(e) => setMeta(e.target.value)}
      />

      <label className={styles.label}>{isSkill ? "Instructions" : "Detail"}</label>
      <textarea
        className={styles.textarea}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={isSkill ? 6 : 3}
      />

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button
          className={styles.secondary}
          onClick={onDismiss}
          disabled={saving}
        >
          Dismiss
        </button>
        <button className={styles.primary} onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
