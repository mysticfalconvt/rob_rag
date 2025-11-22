"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

interface SystemStatus {
  qdrant: "connected" | "disconnected";
  lmStudio: "connected" | "disconnected";
  paperless: "connected" | "disconnected" | "not_configured" | "disabled";
  totalFiles: number;
  totalChunks: number;
  paperlessDocuments?: number;
  config: {
    embeddingModel: string;
    chatModel: string;
  };
}

interface Settings {
  embeddingModel: string;
  chatModel: string;
  embeddingModelDimension: number;
  isDefault?: boolean;
  paperlessUrl: string | null;
  paperlessExternalUrl: string | null;
  paperlessEnabled: boolean;
  paperlessConfigured: boolean;
}

export default function StatusPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState("");
  const [selectedChatModel, setSelectedChatModel] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Paperless-ngx state
  const [paperlessUrl, setPaperlessUrl] = useState("");
  const [paperlessExternalUrl, setPaperlessExternalUrl] = useState("");
  const [paperlessApiToken, setPaperlessApiToken] = useState("");
  const [paperlessEnabled, setPaperlessEnabled] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {
      console.error("Error fetching status:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchModels = async () => {
    try {
      const res = await fetch("/api/models");
      if (res.ok) {
        const data = await res.json();
        const allModels = data.models || [];

        // Filter models based on naming conventions
        // Embedding models typically have 'embed' in their name
        const embedModels = allModels.filter((model: string) =>
          model.toLowerCase().includes("embed"),
        );

        // Chat models are typically instruction-tuned (not embedding models)
        const chatModelsList = allModels.filter(
          (model: string) => !model.toLowerCase().includes("embed"),
        );

        setEmbeddingModels(embedModels);
        setChatModels(chatModelsList);
      }
    } catch (error) {
      console.error("Error fetching models:", error);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setSelectedEmbeddingModel(data.embeddingModel);
        setSelectedChatModel(data.chatModel);
        setPaperlessUrl(data.paperlessUrl || "");
        setPaperlessExternalUrl(data.paperlessExternalUrl || "");
        setPaperlessEnabled(data.paperlessEnabled || false);
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchModels();
    fetchSettings();
    const interval = setInterval(fetchStatus, 10000); // Refresh status every 10s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveSettings = async () => {
    if (!settings) return;

    const embeddingModelChanged =
      selectedEmbeddingModel !== settings.embeddingModel;

    if (embeddingModelChanged) {
      const confirmed = confirm(
        "⚠️ Warning: Changing Embedding Model\n\n" +
          "Changing the embedding model will require re-indexing ALL documents.\n" +
          "Different embedding models produce incompatible vector representations.\n\n" +
          "You will need to:\n" +
          "1. Go to the Files page\n" +
          '2. Click "Force Reindex All"\n' +
          "3. Wait for re-indexing to complete\n\n" +
          "Are you sure you want to continue?",
      );

      if (!confirmed) return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeddingModel: selectedEmbeddingModel,
          chatModel: selectedChatModel,
          embeddingModelDimension: 1024, // TODO: detect this from model
        }),
      });

      if (res.ok) {
        await fetchSettings();
        alert(
          "✅ Settings saved successfully!" +
            (embeddingModelChanged
              ? "\n\n⚠️ Remember to re-index all files!"
              : ""),
        );
      } else {
        alert("❌ Failed to save settings");
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("❌ Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges =
    settings &&
    (selectedEmbeddingModel !== settings.embeddingModel ||
      selectedChatModel !== settings.chatModel);

  const handleTestPaperlessConnection = async () => {
    if (!paperlessUrl) {
      alert("Please enter a Paperless-ngx URL");
      return;
    }

    setIsTesting(true);
    try {
      // Save temporarily to test
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeddingModel: selectedEmbeddingModel,
          chatModel: selectedChatModel,
          embeddingModelDimension: 1024,
          paperlessUrl,
          paperlessExternalUrl: paperlessExternalUrl || undefined,
          paperlessApiToken: paperlessApiToken || undefined,
          paperlessEnabled: true,
        }),
      });

      if (res.ok) {
        // Test the connection
        const statusRes = await fetch("/api/status");
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData.paperless === "connected") {
            alert("✅ Connection successful!");
          } else {
            alert("❌ Connection failed. Please check your URL and API token.");
          }
        }
      } else {
        alert("❌ Failed to test connection");
      }
    } catch (error) {
      console.error("Error testing connection:", error);
      alert("❌ Failed to test connection");
    } finally {
      setIsTesting(false);
    }
  };

  const handleSavePaperlessSettings = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeddingModel: selectedEmbeddingModel,
          chatModel: selectedChatModel,
          embeddingModelDimension: 1024,
          paperlessUrl: paperlessUrl || null,
          paperlessExternalUrl: paperlessExternalUrl || null,
          paperlessApiToken: paperlessApiToken || undefined,
          paperlessEnabled,
        }),
      });

      if (res.ok) {
        await fetchSettings();
        await fetchStatus();
        alert("✅ Paperless-ngx settings saved successfully!");
        setPaperlessApiToken(""); // Clear token input after save
      } else {
        alert("❌ Failed to save settings");
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("❌ Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className={styles.loading}>Loading status...</div>;
  if (!status)
    return <div className={styles.error}>Failed to load status.</div>;

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>System Status</h1>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h2>Connections</h2>
          <div className={styles.item}>
            <span>Qdrant Vector DB</span>
            <span className={`${styles.badge} ${styles[status.qdrant]}`}>
              {status.qdrant}
            </span>
          </div>
          <div className={styles.item}>
            <span>LM Studio API</span>
            <span className={`${styles.badge} ${styles[status.lmStudio]}`}>
              {status.lmStudio}
            </span>
          </div>
          <div className={styles.item}>
            <span>Paperless-ngx</span>
            <span className={`${styles.badge} ${styles[status.paperless]}`}>
              {status.paperless.replace("_", " ")}
            </span>
          </div>
        </div>

        <div className={styles.card}>
          <h2>Statistics</h2>
          <div className={styles.stat}>
            <span className={styles.value}>{status.totalFiles}</span>
            <span className={styles.label}>Indexed Files</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.value}>{status.totalChunks}</span>
            <span className={styles.label}>Total Chunks</span>
          </div>
          {status.paperlessDocuments !== undefined &&
            status.paperlessDocuments > 0 && (
              <div className={styles.stat}>
                <span className={styles.value}>
                  {status.paperlessDocuments}
                </span>
                <span className={styles.label}>Paperless Docs</span>
              </div>
            )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Model Configuration</h2>
            {settings?.isDefault && (
              <span
                className={styles.defaultBadge}
                title="Using environment variables"
              >
                Default
              </span>
            )}
          </div>

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
              onChange={(e) => setSelectedEmbeddingModel(e.target.value)}
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
              onChange={(e) => setSelectedChatModel(e.target.value)}
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
            onClick={handleSaveSettings}
            disabled={!hasChanges || isSaving}
            className={styles.saveButton}
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>

        <div className={styles.card}>
          <h2>Paperless-ngx Configuration</h2>

          <div className={styles.formGroup}>
            <label htmlFor="paperlessUrl">Paperless-ngx API URL</label>
            <input
              id="paperlessUrl"
              type="text"
              value={paperlessUrl}
              onChange={(e) => setPaperlessUrl(e.target.value)}
              placeholder="http://localhost:8000"
              className={styles.input}
              disabled={isSaving}
            />
            <small className={styles.helpText}>
              Internal URL for API connections
            </small>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="paperlessExternalUrl">
              External URL (Optional)
            </label>
            <input
              id="paperlessExternalUrl"
              type="text"
              value={paperlessExternalUrl}
              onChange={(e) => setPaperlessExternalUrl(e.target.value)}
              placeholder="https://paperless.example.com"
              className={styles.input}
              disabled={isSaving}
            />
            <small className={styles.helpText}>
              Public URL for browser links (leave empty to use API URL)
            </small>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="paperlessApiToken">API Token</label>
            <input
              id="paperlessApiToken"
              type="password"
              value={paperlessApiToken}
              onChange={(e) => setPaperlessApiToken(e.target.value)}
              placeholder={
                settings?.paperlessConfigured ? "••••••••" : "Enter API token"
              }
              className={styles.input}
              disabled={isSaving}
            />
          </div>

          <div className={styles.formGroup}>
            <label>
              <input
                type="checkbox"
                checked={paperlessEnabled}
                onChange={(e) => setPaperlessEnabled(e.target.checked)}
                disabled={isSaving}
              />{" "}
              Enable Paperless-ngx Integration
            </label>
          </div>

          <div className={styles.buttonGroup}>
            <button
              onClick={handleTestPaperlessConnection}
              disabled={!paperlessUrl || isTesting}
              className={styles.testButton}
            >
              {isTesting ? "Testing..." : "Test Connection"}
            </button>
            <button
              onClick={handleSavePaperlessSettings}
              disabled={isSaving}
              className={styles.saveButton}
            >
              {isSaving ? "Saving..." : "Save Paperless Settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
