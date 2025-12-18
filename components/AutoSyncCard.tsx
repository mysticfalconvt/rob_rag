"use client";

import { useState, useEffect } from "react";
import styles from "./AutoSyncCard.module.css";

interface AutoSyncCardProps {
  onSyncAll: () => void;
  isSyncing: boolean;
}

export default function AutoSyncCard({ onSyncAll, isSyncing }: AutoSyncCardProps) {
  const [webhookUrl, setWebhookUrl] = useState<string>("");

  useEffect(() => {
    // Get the current origin for webhook URL
    if (typeof window !== "undefined") {
      setWebhookUrl(`${window.location.origin}/api/webhooks/sync-all`);
    }
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("✅ Copied to clipboard!");
  };

  return (
    <div className={styles.card}>
      <h2>
        <i className="fas fa-clock"></i> Automated Syncing
      </h2>

      <div className={styles.section}>
        <h3>Manual Trigger</h3>
        <p className={styles.description}>
          Sync all sources (Google Calendar, Goodreads, Paperless) and index new/changed items only.
        </p>
        <button
          onClick={onSyncAll}
          disabled={isSyncing}
          className={styles.syncButton}
        >
          <i className={`fas fa-sync-alt ${isSyncing ? "fa-spin" : ""}`}></i>
          {isSyncing ? "Syncing..." : "Sync All Sources Now"}
        </button>
      </div>

      <div className={styles.section}>
        <h3>Webhook Endpoint</h3>
        <p className={styles.description}>
          Use this endpoint with external cron services (cron-job.org, GitHub Actions, etc.)
          to schedule automated syncing.
        </p>

        <div className={styles.urlBox}>
          <code className={styles.url}>{webhookUrl || "Loading..."}</code>
          <button
            onClick={() => copyToClipboard(webhookUrl)}
            className={styles.copyButton}
            title="Copy URL"
          >
            <i className="fas fa-copy"></i>
          </button>
        </div>

        <div className={styles.curlExample}>
          <h4>Example cURL:</h4>
          <pre className={styles.codeBlock}>
{`curl -X POST ${webhookUrl || "https://your-app.com/api/webhooks/sync-all"} \\
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \\
  -H "Content-Type: application/json"`}
          </pre>
          <button
            onClick={() => copyToClipboard(
              `curl -X POST ${webhookUrl} -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" -H "Content-Type: application/json"`
            )}
            className={styles.copyButtonSmall}
          >
            <i className="fas fa-copy"></i> Copy
          </button>
        </div>

      </div>
    </div>
  );
}
