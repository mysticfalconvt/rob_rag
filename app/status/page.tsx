"use client";

import { useEffect, useState } from "react";
import StatusConnections from "@/components/StatusConnections";
import StatisticsCard from "@/components/StatisticsCard";
import ReindexCard from "@/components/ReindexCard";
import styles from "./page.module.css";

interface GoodreadsUserStatus {
  id: string;
  name: string;
  email?: string;
  bookCount: number;
  lastSyncedAt?: string;
}

interface SystemStatus {
  qdrant: "connected" | "disconnected";
  lmStudio: "connected" | "disconnected";
  paperless: "connected" | "disconnected" | "not_configured" | "disabled";
  goodreads: "connected" | "not_configured";
  goodreadsUsers?: GoodreadsUserStatus[];
  totalFiles: number;
  totalChunks: number;
  uploadedFiles?: number;
  syncedFiles?: number;
  paperlessDocuments?: number;
  goodreadsUserCount?: number;
  goodreadsBooks?: number;
  averageChunksPerFile?: number;
  config: {
    embeddingModel: string;
    chatModel: string;
  };
}

export default function StatusPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReindexing, setIsReindexing] = useState<string | null>(null);

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

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleReindexSource = async (source: string, label: string) => {
    if (
      !confirm(`Reindex all ${label} documents? This may take a few minutes.`)
    ) {
      return;
    }

    setIsReindexing(source);
    try {
      const res = await fetch("/api/reindex/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });

      if (res.ok) {
        const data = await res.json();
        alert(`✅ ${data.message}`);
        await fetchStatus();
      } else {
        const error = await res.json();
        alert(`❌ Reindex failed: ${error.details || error.error}`);
      }
    } catch (error) {
      console.error("Error reindexing:", error);
      alert("❌ Failed to reindex");
    } finally {
      setIsReindexing(null);
    }
  };

  if (isLoading) return <div className={styles.loading}>Loading status...</div>;
  if (!status)
    return <div className={styles.error}>Failed to load status.</div>;

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>System Status</h1>

      <div className={styles.grid}>
        <StatusConnections
          status={{
            qdrant: status.qdrant,
            lmStudio: status.lmStudio,
            paperless: status.paperless,
            goodreads: status.goodreads,
            goodreadsUsers: status.goodreadsUsers,
          }}
        />

        <StatisticsCard
          totalFiles={status.totalFiles}
          totalChunks={status.totalChunks}
          uploadedFiles={status.uploadedFiles}
          syncedFiles={status.syncedFiles}
          paperlessDocuments={status.paperlessDocuments}
          goodreadsBooks={status.goodreadsBooks}
          goodreadsUsers={status.goodreadsUserCount}
          averageChunksPerFile={status.averageChunksPerFile}
        />

        <ReindexCard
          paperlessDocuments={status.paperlessDocuments}
          goodreadsBooks={status.goodreadsBooks}
          isReindexing={isReindexing}
          onReindexSource={handleReindexSource}
        />
      </div>
    </div>
  );
}
