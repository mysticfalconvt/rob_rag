"use client";

import { useState, useEffect } from "react";
import Card from "./Card";

interface DataSyncCardProps {
  dailySyncTime: string | null;
  lastRun: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  onSave: (time: string) => Promise<void>;
  onSyncNow: () => Promise<void>;
  isSaving: boolean;
  isSyncing: boolean;
}

export default function DataSyncCard({
  dailySyncTime,
  lastRun,
  lastStatus,
  lastError,
  onSave,
  onSyncNow,
  isSaving,
  isSyncing,
}: DataSyncCardProps) {
  const [syncTime, setSyncTime] = useState(dailySyncTime || "03:00");

  useEffect(() => {
    if (dailySyncTime) {
      setSyncTime(dailySyncTime);
    }
  }, [dailySyncTime]);

  const handleSave = async () => {
    await onSave(syncTime);
  };

  const formatLastRun = (date: Date | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <Card title="Data Source Sync">
      <p style={{ marginBottom: "1rem", color: "#666", fontSize: "0.9rem" }}>
        Automatically sync all data sources (Google Calendar, Paperless, Goodreads) daily at a scheduled time.
      </p>

      <div style={{ marginBottom: "1.5rem" }}>
        <label htmlFor="syncTime" style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
          Daily Sync Time
        </label>
        <input
          id="syncTime"
          type="time"
          value={syncTime}
          onChange={(e) => setSyncTime(e.target.value)}
          disabled={isSaving}
          style={{
            padding: "0.5rem",
            fontSize: "1rem",
            border: "1px solid var(--border-color)",
            borderRadius: "4px",
            background: "var(--bg-secondary)",
            color: "var(--text-color)",
            width: "150px",
          }}
        />
        <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
          Time when daily sync will run (24-hour format)
        </p>
      </div>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            padding: "0.5rem 1rem",
            background: "#10b981",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isSaving ? "not-allowed" : "pointer",
            opacity: isSaving ? 0.6 : 1,
            fontWeight: "500",
          }}
        >
          {isSaving ? "Saving..." : "Save Schedule"}
        </button>

        <button
          onClick={onSyncNow}
          disabled={isSyncing}
          style={{
            padding: "0.5rem 1rem",
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isSyncing ? "not-allowed" : "pointer",
            opacity: isSyncing ? 0.6 : 1,
            fontWeight: "500",
          }}
        >
          {isSyncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      <div style={{
        padding: "1rem",
        background: lastStatus === "failed" ? "rgba(239, 68, 68, 0.1)" : lastStatus === "success" ? "rgba(16, 185, 129, 0.1)" : "rgba(107, 114, 128, 0.1)",
        border: `1px solid ${lastStatus === "failed" ? "rgba(239, 68, 68, 0.3)" : lastStatus === "success" ? "rgba(16, 185, 129, 0.3)" : "rgba(107, 114, 128, 0.3)"}`,
        borderRadius: "4px",
        fontSize: "0.9rem",
        color: "var(--text-color)"
      }}>
        <div style={{ marginBottom: "0.5rem" }}>
          <strong>Last Sync:</strong> {formatLastRun(lastRun)}
        </div>
        <div style={{ marginBottom: "0.5rem" }}>
          <strong>Status:</strong>{" "}
          <span style={{
            color: lastStatus === "success" ? "#10b981" : lastStatus === "failed" ? "#ef4444" : "#9ca3af",
            fontWeight: "500"
          }}>
            {lastStatus === "success" ? "✓ Success" : lastStatus === "failed" ? "✗ Failed" : "—"}
          </span>
        </div>
        {lastError && (
          <div style={{ color: "#f87171", marginTop: "0.5rem" }}>
            <strong>Error:</strong> {lastError}
          </div>
        )}
      </div>

      <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#666" }}>
        <strong>Note:</strong> This will sync all configured data sources in a single operation.
      </div>
    </Card>
  );
}
