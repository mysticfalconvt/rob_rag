"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import ModelConfiguration from "@/components/ModelConfiguration";
import PaperlessConfiguration from "@/components/PaperlessConfiguration";
import CustomOcrConfiguration from "@/components/CustomOcrConfiguration";
import SyncedFilesConfiguration from "@/components/SyncedFilesConfiguration";
import PaperlessSyncConfig from "@/components/PaperlessSyncConfig";
import GoodreadsIntegration from "@/components/GoodreadsIntegration";
import GoogleCalendarConfig from "@/components/GoogleCalendarConfig";
import PromptConfiguration from "@/components/PromptConfiguration";
import UserProfile from "@/components/UserProfile";
import ContextWindowSettings from "@/components/ContextWindowSettings";
import styles from "./page.module.css";

interface Settings {
  embeddingModel: string;
  chatModel: string;
  fastChatModel?: string | null;
  visionModel?: string | null;
  embeddingModelDimension: number;
  isDefault?: boolean;
  paperlessUrl: string | null;
  paperlessExternalUrl: string | null;
  paperlessEnabled: boolean;
  paperlessConfigured: boolean;
  customOcrEnabled: boolean;
}

interface User {
  id: string;
  name: string;
  email: string | null;
  goodreadsSources: {
    id: string;
    rssFeedUrl: string;
    lastSyncedAt: string | null;
  } | null;
  _count: {
    goodreadsBooks: number;
  };
}

export default function ConfigPage() {
  const { isAdmin } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [visionModels, setVisionModels] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState("");
  const [selectedChatModel, setSelectedChatModel] = useState("");
  const [selectedFastChatModel, setSelectedFastChatModel] = useState("");
  const [selectedVisionModel, setSelectedVisionModel] = useState("");
  const [customOcrEnabled, setCustomOcrEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [paperlessUrl, setPaperlessUrl] = useState("");
  const [paperlessExternalUrl, setPaperlessExternalUrl] = useState("");
  const [paperlessApiToken, setPaperlessApiToken] = useState("");
  const [paperlessEnabled, setPaperlessEnabled] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  const [syncedFilesConfig, setSyncedFilesConfig] = useState<any>(null);

  const [paperlessSyncEnabled, setPaperlessSyncEnabled] = useState(false);
  const [paperlessSyncInterval, setPaperlessSyncInterval] = useState(60);
  const [paperlessSyncLastRun, setPaperlessSyncLastRun] = useState<Date | null>(null);
  const [paperlessSyncFilters, setPaperlessSyncFilters] = useState<any>(null);
  const [paperlessAutoOcr, setPaperlessAutoOcr] = useState(false);
  const [isSyncingPaperless, setIsSyncingPaperless] = useState(false);

  const fetchModels = async () => {
    try {
      const res = await fetch("/api/models");
      if (res.ok) {
        const data = await res.json();
        const allModels = data.models || [];
        const embedModels = allModels.filter((model: string) =>
          model.toLowerCase().includes("embed"),
        );
        const chatModelsList = allModels.filter(
          (model: string) => !model.toLowerCase().includes("embed"),
        );
        // Vision models typically have "vision", "vl", "llava", "pixtral", "ocr" in their names
        const visionModelsList = allModels.filter((model: string) => {
          const lower = model.toLowerCase();
          return (
            lower.includes("vision") ||
            lower.includes("-vl") ||
            lower.includes("llava") ||
            lower.includes("pixtral") ||
            lower.includes("qwen2-vl") ||
            lower.includes("ocr") ||
            lower.includes("gemma")
          );
        });
        setEmbeddingModels(embedModels);
        setChatModels(chatModelsList);
        setVisionModels(visionModelsList);
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
        setSelectedFastChatModel(data.fastChatModel || "");
        setSelectedVisionModel(data.visionModel || "");
        setCustomOcrEnabled(data.customOcrEnabled || false);
        setPaperlessUrl(data.paperlessUrl || "");
        setPaperlessExternalUrl(data.paperlessExternalUrl || "");
        setPaperlessEnabled(data.paperlessEnabled || false);

        // Load synced files config
        if (data.syncedFilesConfig) {
          try {
            setSyncedFilesConfig(JSON.parse(data.syncedFilesConfig));
          } catch (e) {
            console.error('Failed to parse syncedFilesConfig:', e);
            setSyncedFilesConfig(null);
          }
        } else {
          setSyncedFilesConfig(null);
        }

        // Load Paperless sync settings
        setPaperlessSyncEnabled(data.paperlessSyncEnabled || false);
        setPaperlessSyncInterval(data.paperlessSyncInterval || 60);
        setPaperlessSyncLastRun(data.paperlessSyncLastRun ? new Date(data.paperlessSyncLastRun) : null);
        setPaperlessAutoOcr(data.paperlessAutoOcr || false);

        if (data.paperlessSyncFilters) {
          try {
            setPaperlessSyncFilters(JSON.parse(data.paperlessSyncFilters));
          } catch (e) {
            console.error('Failed to parse paperlessSyncFilters:', e);
            setPaperlessSyncFilters(null);
          }
        } else {
          setPaperlessSyncFilters(null);
        }
      }
    } catch (error) {
      console.error("Error fetching settings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const res = await fetch("/api/goodreads/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchModels();
    fetchSettings();
    fetchUsers();
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
          fastChatModel: selectedFastChatModel || null,
          visionModel: selectedVisionModel || null,
          embeddingModelDimension: 1024,
          customOcrEnabled,
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

  const handleTestPaperlessConnection = async () => {
    if (!paperlessUrl) {
      alert("Please enter a Paperless-ngx URL");
      return;
    }

    setIsTesting(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeddingModel: selectedEmbeddingModel,
          chatModel: selectedChatModel,
          visionModel: selectedVisionModel || null,
          embeddingModelDimension: 1024,
          customOcrEnabled,
          paperlessUrl,
          paperlessExternalUrl: paperlessExternalUrl || undefined,
          paperlessApiToken: paperlessApiToken || undefined,
          paperlessEnabled: true,
        }),
      });

      if (res.ok) {
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
          visionModel: selectedVisionModel || null,
          embeddingModelDimension: 1024,
          customOcrEnabled,
          paperlessUrl: paperlessUrl || null,
          paperlessExternalUrl: paperlessExternalUrl || null,
          paperlessApiToken: paperlessApiToken || undefined,
          paperlessEnabled,
        }),
      });

      if (res.ok) {
        await fetchSettings();
        alert("✅ Paperless-ngx settings saved successfully!");
        setPaperlessApiToken("");
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

  const handleSaveOcrSettings = async () => {
    if (!selectedVisionModel) {
      alert("⚠️ Please select a vision model");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeddingModel: selectedEmbeddingModel,
          chatModel: selectedChatModel,
          embeddingModelDimension: 1024,
          visionModel: selectedVisionModel || null,
          customOcrEnabled,
        }),
      });

      if (res.ok) {
        await fetchSettings();
        alert("✅ Custom OCR settings saved successfully!");
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

  const handleAddUser = async (name: string, email: string) => {
    try {
      const res = await fetch("/api/goodreads/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: email || null,
        }),
      });

      if (res.ok) {
        await fetchUsers();
        alert("✅ User added successfully!");
      } else {
        alert("❌ Failed to add user");
      }
    } catch (error) {
      console.error("Error adding user:", error);
      alert("❌ Failed to add user");
    }
  };

  const handleUploadCSV = async (userId: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", userId);

      const res = await fetch("/api/goodreads/upload-csv", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        alert(
          `✅ CSV uploaded! Created: ${data.created}, Updated: ${data.updated}`,
        );
        await fetchUsers();
      } else {
        const error = await res.json();
        alert(`❌ Failed to upload CSV: ${error.details || error.error}`);
      }
    } catch (error) {
      console.error("Error uploading CSV:", error);
      alert("❌ Failed to upload CSV");
    }
  };

  const handleSaveSyncedFilesConfig = async (config: any) => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncedFilesConfig: JSON.stringify(config),
        }),
      });

      if (res.ok) {
        await fetchSettings();
        alert("✅ Synced files configuration saved! Run a scan from the Status page to apply changes.");
      } else {
        alert("❌ Failed to save configuration");
      }
    } catch (error) {
      console.error("Error saving synced files config:", error);
      alert("❌ Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePaperlessSyncConfig = async (settings: any) => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperlessSyncEnabled: settings.paperlessSyncEnabled,
          paperlessSyncInterval: settings.paperlessSyncInterval,
          paperlessSyncFilters: JSON.stringify(settings.paperlessSyncFilters),
          paperlessAutoOcr: settings.paperlessAutoOcr,
        }),
      });

      if (res.ok) {
        await fetchSettings();
        alert("✅ Paperless auto-sync configuration saved!");
      } else {
        alert("❌ Failed to save configuration");
      }
    } catch (error) {
      console.error("Error saving Paperless sync config:", error);
      alert("❌ Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncPaperlessNow = async () => {
    setIsSyncingPaperless(true);
    try {
      const res = await fetch("/api/paperless/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (res.ok) {
        const data = await res.json();
        const result = data.result;
        if (result) {
          const messages = [
            `New documents: ${result.newDocuments}`,
            `Updated documents: ${result.updatedDocuments}`,
            result.skippedDocuments > 0 ? `Skipped: ${result.skippedDocuments}` : null,
            result.ocrJobsStarted > 0 ? `OCR jobs started: ${result.ocrJobsStarted}` : null,
            result.errors.length > 0 ? `\n\n⚠️ Errors: ${result.errors.length}` : null,
          ].filter(Boolean).join('\n');

          await fetchSettings(); // Refresh last sync time
          alert(`✅ Paperless sync complete!\n\n${messages}`);
        } else {
          alert("✅ Sync complete!");
        }
        await fetchSettings();
      } else {
        const error = await res.json();
        alert(`❌ Sync failed: ${error.details || error.error}`);
      }
    } catch (error) {
      console.error("Error syncing Paperless:", error);
      alert("❌ Failed to sync");
    } finally {
      setIsSyncingPaperless(false);
    }
  };

  const handleSaveRSSFeed = async (userId: string, rssUrl: string) => {
    try {
      const res = await fetch("/api/goodreads/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, rssFeedUrl: rssUrl }),
      });

      if (res.ok) {
        alert("✅ RSS feed saved!");
        await fetchUsers();
      } else {
        alert("❌ Failed to save RSS feed");
      }
    } catch (error) {
      console.error("Error saving RSS feed:", error);
      alert("❌ Failed to save RSS feed");
    }
  };

  const handleSyncRSS = async (userId: string) => {
    try {
      const res = await fetch("/api/goodreads/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (res.ok) {
        const data = await res.json();
        alert(
          `✅ Sync complete! Created: ${data.created}, Updated: ${data.updated}`,
        );
        await fetchUsers();
      } else {
        const error = await res.json();
        alert(`❌ Sync failed: ${error.details || error.error}`);
      }
    } catch (error) {
      console.error("Error syncing RSS:", error);
      alert("❌ Failed to sync RSS feed");
    }
  };

  const hasChanges = !!(
    settings &&
    (selectedEmbeddingModel !== settings.embeddingModel ||
      selectedChatModel !== settings.chatModel ||
      selectedFastChatModel !== (settings.fastChatModel || ""))
  );

  if (isLoading)
    return <div className={styles.loading}>Loading configuration...</div>;

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Configuration</h1>

      <div className={styles.grid}>
        {/* User Profile - Available to all users */}
        <UserProfile />

        {/* Admin-only sections */}
        {isAdmin && (
          <>
            <ModelConfiguration
              settings={settings}
              embeddingModels={embeddingModels}
              chatModels={chatModels}
              selectedEmbeddingModel={selectedEmbeddingModel}
              selectedChatModel={selectedChatModel}
              selectedFastChatModel={selectedFastChatModel}
              isSaving={isSaving}
              hasChanges={hasChanges}
              onEmbeddingModelChange={setSelectedEmbeddingModel}
              onChatModelChange={setSelectedChatModel}
              onFastChatModelChange={setSelectedFastChatModel}
              onSave={handleSaveSettings}
            />

            <PaperlessConfiguration
              paperlessUrl={paperlessUrl}
              paperlessExternalUrl={paperlessExternalUrl}
              paperlessApiToken={paperlessApiToken}
              paperlessEnabled={paperlessEnabled}
              paperlessConfigured={settings?.paperlessConfigured || false}
              isTesting={isTesting}
              isSaving={isSaving}
              onUrlChange={setPaperlessUrl}
              onExternalUrlChange={setPaperlessExternalUrl}
              onTokenChange={setPaperlessApiToken}
              onEnabledChange={setPaperlessEnabled}
              onTest={handleTestPaperlessConnection}
              onSave={handleSavePaperlessSettings}
            />

            <CustomOcrConfiguration
              visionModels={visionModels}
              selectedVisionModel={selectedVisionModel}
              customOcrEnabled={customOcrEnabled}
              onVisionModelChange={setSelectedVisionModel}
              onEnabledChange={setCustomOcrEnabled}
              onSave={handleSaveOcrSettings}
              isSaving={isSaving}
            />

            <SyncedFilesConfiguration
              config={syncedFilesConfig}
              onSave={handleSaveSyncedFilesConfig}
              isSaving={isSaving}
            />

            <PaperlessSyncConfig
              settings={{
                paperlessSyncEnabled,
                paperlessSyncInterval,
                paperlessSyncLastRun,
                paperlessSyncFilters,
                paperlessAutoOcr,
              }}
              paperlessEnabled={paperlessEnabled}
              onSave={handleSavePaperlessSyncConfig}
              onSyncNow={handleSyncPaperlessNow}
              isSaving={isSaving}
              isSyncing={isSyncingPaperless}
            />

            <PromptConfiguration />

            <ContextWindowSettings />

            <GoogleCalendarConfig />

            {/* Goodreads - Admin only */}
            <GoodreadsIntegration
              users={users}
              isLoadingUsers={isLoadingUsers}
              onAddUser={handleAddUser}
              onUploadCSV={handleUploadCSV}
              onSaveRSSFeed={handleSaveRSSFeed}
              onSyncRSS={handleSyncRSS}
            />
          </>
        )}
      </div>
    </div>
  );
}
