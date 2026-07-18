"use client";

import { useEffect, useState } from "react";
import Toast from "@/components/Toast";
import styles from "./AssistantConfiguration.module.css";

interface Skill {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
}
interface Memory {
  slug: string;
  name: string;
  description: string;
  type: string;
  body: string;
}

type SkillDraft = { name: string; description: string; whenToUse: string; body: string };
type MemoryDraft = { name: string; description: string; type: string; body: string };

const EMPTY_SKILL: SkillDraft = { name: "", description: "", whenToUse: "", body: "" };
const EMPTY_MEMORY: MemoryDraft = { name: "", description: "", type: "note", body: "" };

export default function AssistantConfiguration() {
  const [soul, setSoul] = useState("");
  const [soulDefault, setSoulDefault] = useState("");
  const [autoTriage, setAutoTriage] = useState(true);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSoul, setSavingSoul] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const notify = (message: string, type: "success" | "error" = "success") =>
    setToast({ message, type });

  useEffect(() => {
    (async () => {
      try {
        const [soulRes, triageRes, skillsRes, memRes] = await Promise.all([
          fetch("/api/assistant/soul"),
          fetch("/api/assistant"),
          fetch("/api/assistant/skills"),
          fetch("/api/assistant/memory"),
        ]);
        if (soulRes.ok) {
          const d = await soulRes.json();
          setSoul(d.soul ?? "");
          setSoulDefault(d.default ?? "");
        }
        if (triageRes.ok) setAutoTriage((await triageRes.json()).autoTriage ?? true);
        if (skillsRes.ok) setSkills(await skillsRes.json());
        if (memRes.ok) setMemories(await memRes.json());
      } catch (e) {
        console.error("Failed to load assistant config:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const refreshSkills = async () => {
    const res = await fetch("/api/assistant/skills");
    if (res.ok) setSkills(await res.json());
  };
  const refreshMemories = async () => {
    const res = await fetch("/api/assistant/memory");
    if (res.ok) setMemories(await res.json());
  };

  const saveSoul = async () => {
    setSavingSoul(true);
    try {
      const res = await fetch("/api/assistant/soul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soul }),
      });
      if (!res.ok) throw new Error();
      notify("Soul saved");
    } catch {
      notify("Failed to save soul", "error");
    } finally {
      setSavingSoul(false);
    }
  };

  const toggleTriage = async (next: boolean) => {
    setAutoTriage(next);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoTriage: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setAutoTriage(!next);
      notify("Failed to update setting", "error");
    }
  };

  const saveSkill = async () => {
    if (!skillDraft?.name.trim() || !skillDraft.body.trim()) {
      notify("Skill name and instructions are required", "error");
      return;
    }
    try {
      const res = await fetch("/api/assistant/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skillDraft),
      });
      if (!res.ok) throw new Error();
      setSkillDraft(null);
      await refreshSkills();
      notify("Skill saved");
    } catch {
      notify("Failed to save skill", "error");
    }
  };

  const deleteSkill = async (name: string) => {
    if (!confirm(`Delete skill "${name}"?`)) return;
    try {
      const res = await fetch(`/api/assistant/skills?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      await refreshSkills();
      notify("Skill deleted");
    } catch {
      notify("Failed to delete skill", "error");
    }
  };

  const saveMemory = async () => {
    if (!memoryDraft?.name.trim() || !memoryDraft.body.trim()) {
      notify("Memory name and detail are required", "error");
      return;
    }
    try {
      const res = await fetch("/api/assistant/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(memoryDraft),
      });
      if (!res.ok) throw new Error();
      setMemoryDraft(null);
      await refreshMemories();
      notify("Memory saved");
    } catch {
      notify("Failed to save memory", "error");
    }
  };

  const deleteMemory = async (name: string) => {
    if (!confirm(`Delete memory "${name}"?`)) return;
    try {
      const res = await fetch(`/api/assistant/memory?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      await refreshMemories();
      notify("Memory deleted");
    } catch {
      notify("Failed to delete memory", "error");
    }
  };

  if (loading) {
    return (
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Assistant: Soul, Skills &amp; Memory</h2>
        <div className={styles.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <>
      {/* Soul */}
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>Soul</h2>
            <p className={styles.subtitle}>
              The assistant&apos;s persona — injected into every conversation.
            </p>
          </div>
          <div className={styles.buttonGroup}>
            <button
              className={styles.resetButton}
              onClick={() => {
                if (confirm("Reset the soul to its default text?")) setSoul(soulDefault);
              }}
              disabled={savingSoul}
            >
              Reset
            </button>
            <button className={styles.saveButton} onClick={saveSoul} disabled={savingSoul}>
              {savingSoul ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <textarea
          className={styles.textarea}
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
          rows={6}
        />
      </div>

      {/* Auto-triage toggle */}
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>Post-conversation triage</h2>
            <p className={styles.subtitle}>
              After each chat, suggest saving a skill or memory when something looks worth keeping.
            </p>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={autoTriage}
              onChange={(e) => toggleTriage(e.target.checked)}
            />
            <span>{autoTriage ? "On" : "Off"}</span>
          </label>
        </div>
      </div>

      {/* Skills */}
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>Skills</h2>
            <p className={styles.subtitle}>
              Reusable instructions the assistant can load via the use_skill tool.
            </p>
          </div>
          <div className={styles.buttonGroup}>
            <button
              className={styles.saveButton}
              onClick={() => setSkillDraft({ ...EMPTY_SKILL })}
            >
              + New skill
            </button>
          </div>
        </div>

        {skills.length === 0 && !skillDraft && (
          <p className={styles.description}>No skills yet.</p>
        )}

        <div className={styles.list}>
          {skills.map((s) => (
            <div key={s.slug} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowName}>{s.name}</span>
                <span className={styles.rowDesc}>{s.description}</span>
                {s.whenToUse && (
                  <span className={styles.rowHint}>Use when: {s.whenToUse}</span>
                )}
              </div>
              <div className={styles.rowActions}>
                <button
                  className={styles.linkBtn}
                  onClick={() =>
                    setSkillDraft({
                      name: s.name,
                      description: s.description,
                      whenToUse: s.whenToUse,
                      body: s.body,
                    })
                  }
                >
                  Edit
                </button>
                <button
                  className={styles.linkBtnDanger}
                  onClick={() => deleteSkill(s.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {skillDraft && (
          <div className={styles.editor}>
            <label className={styles.label}>Name</label>
            <input
              className={styles.input}
              value={skillDraft.name}
              onChange={(e) => setSkillDraft({ ...skillDraft, name: e.target.value })}
            />
            <label className={styles.label}>Description</label>
            <input
              className={styles.input}
              value={skillDraft.description}
              onChange={(e) =>
                setSkillDraft({ ...skillDraft, description: e.target.value })
              }
            />
            <label className={styles.label}>When to use</label>
            <input
              className={styles.input}
              value={skillDraft.whenToUse}
              onChange={(e) =>
                setSkillDraft({ ...skillDraft, whenToUse: e.target.value })
              }
            />
            <label className={styles.label}>Instructions</label>
            <textarea
              className={styles.textarea}
              rows={6}
              value={skillDraft.body}
              onChange={(e) => setSkillDraft({ ...skillDraft, body: e.target.value })}
            />
            <div className={styles.editorActions}>
              <button className={styles.resetButton} onClick={() => setSkillDraft(null)}>
                Cancel
              </button>
              <button className={styles.saveButton} onClick={saveSkill}>
                Save skill
              </button>
            </div>
            <p className={styles.description}>
              Saving with an existing name overwrites that skill.
            </p>
          </div>
        )}
      </div>

      {/* Memory */}
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.cardTitle}>Memory</h2>
            <p className={styles.subtitle}>
              Durable facts injected into every conversation (full text fetched via recall_memory).
            </p>
          </div>
          <div className={styles.buttonGroup}>
            <button
              className={styles.saveButton}
              onClick={() => setMemoryDraft({ ...EMPTY_MEMORY })}
            >
              + New memory
            </button>
          </div>
        </div>

        {memories.length === 0 && !memoryDraft && (
          <p className={styles.description}>No memories yet.</p>
        )}

        <div className={styles.list}>
          {memories.map((m) => (
            <div key={m.slug} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowName}>
                  {m.name} <span className={styles.tag}>{m.type}</span>
                </span>
                <span className={styles.rowDesc}>{m.description}</span>
              </div>
              <div className={styles.rowActions}>
                <button
                  className={styles.linkBtn}
                  onClick={() =>
                    setMemoryDraft({
                      name: m.name,
                      description: m.description,
                      type: m.type,
                      body: m.body,
                    })
                  }
                >
                  Edit
                </button>
                <button
                  className={styles.linkBtnDanger}
                  onClick={() => deleteMemory(m.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {memoryDraft && (
          <div className={styles.editor}>
            <label className={styles.label}>Name</label>
            <input
              className={styles.input}
              value={memoryDraft.name}
              onChange={(e) => setMemoryDraft({ ...memoryDraft, name: e.target.value })}
            />
            <label className={styles.label}>Description</label>
            <input
              className={styles.input}
              value={memoryDraft.description}
              onChange={(e) =>
                setMemoryDraft({ ...memoryDraft, description: e.target.value })
              }
            />
            <label className={styles.label}>Type</label>
            <input
              className={styles.input}
              value={memoryDraft.type}
              onChange={(e) => setMemoryDraft({ ...memoryDraft, type: e.target.value })}
            />
            <label className={styles.label}>Detail</label>
            <textarea
              className={styles.textarea}
              rows={3}
              value={memoryDraft.body}
              onChange={(e) => setMemoryDraft({ ...memoryDraft, body: e.target.value })}
            />
            <div className={styles.editorActions}>
              <button className={styles.resetButton} onClick={() => setMemoryDraft(null)}>
                Cancel
              </button>
              <button className={styles.saveButton} onClick={saveMemory}>
                Save memory
              </button>
            </div>
            <p className={styles.description}>
              Saving with an existing name overwrites that memory.
            </p>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  );
}
