"use client";

import { useState } from "react";
import styles from "./GoodreadsIntegration.module.css";

interface User {
  id: string;
  name: string;
  email: string | null;
  goodreadsSources: Array<{
    id: string;
    rssFeedUrl: string;
    lastSyncedAt: string | null;
  }>;
  _count: {
    goodreadsBooks: number;
  };
}

interface GoodreadsIntegrationProps {
  users: User[];
  isLoadingUsers: boolean;
  onAddUser: (name: string, email: string) => Promise<void>;
  onUploadCSV: (userId: string, file: File) => Promise<void>;
  onSaveRSSFeed: (userId: string, rssUrl: string) => Promise<void>;
  onSyncRSS: (userId: string) => Promise<void>;
}

export default function GoodreadsIntegration({
  users,
  isLoadingUsers,
  onAddUser,
  onUploadCSV,
  onSaveRSSFeed,
  onSyncRSS,
}: GoodreadsIntegrationProps) {
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleAddUser = async () => {
    if (!newUserName.trim()) {
      alert("Please enter a user name");
      return;
    }
    await onAddUser(newUserName, newUserEmail);
    setShowAddUser(false);
    setNewUserName("");
    setNewUserEmail("");
  };

  const handleUploadCSV = async () => {
    if (!csvFile || !selectedUserId) {
      alert("Please select a user and CSV file");
      return;
    }
    setIsUploading(true);
    await onUploadCSV(selectedUserId, csvFile);
    setCsvFile(null);
    setSelectedUserId("");
    setIsUploading(false);
  };

  const handleSaveRSSFeed = async (userId: string) => {
    if (!rssUrl.trim()) {
      alert("Please enter an RSS feed URL");
      return;
    }
    setIsSaving(true);
    await onSaveRSSFeed(userId, rssUrl);
    setRssUrl("");
    setIsSaving(false);
  };

  const handleSyncRSS = async (userId: string) => {
    setIsSyncing(true);
    await onSyncRSS(userId);
    setIsSyncing(false);
  };

  return (
    <div className={styles.card}>
      <h2>Goodreads Library Integration</h2>

      <div className={styles.formGroup}>
        <button
          onClick={() => setShowAddUser(!showAddUser)}
          className={styles.addButton}
        >
          {showAddUser ? "Cancel" : "+ Add User"}
        </button>
      </div>

      {showAddUser && (
        <div className={styles.formGroup}>
          <input
            type="text"
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            placeholder="User name"
            className={styles.input}
          />
          <input
            type="email"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            placeholder="Email (optional)"
            className={styles.input}
          />
          <button onClick={handleAddUser} className={styles.saveButton}>
            Add User
          </button>
        </div>
      )}

      {isLoadingUsers ? (
        <p>Loading users...</p>
      ) : users.length === 0 ? (
        <p>No users yet. Add a user to get started.</p>
      ) : (
        users.map((user) => (
          <div key={user.id} className={styles.userCard}>
            <h3>{user.name}</h3>
            <p>Books: {user._count.goodreadsBooks}</p>

            {user.goodreadsSources.length > 0 && (
              <div>
                <p>
                  RSS Feed configured
                  {user.goodreadsSources[0].lastSyncedAt && (
                    <span>
                      {" "}
                      - Last synced:{" "}
                      {new Date(
                        user.goodreadsSources[0].lastSyncedAt
                      ).toLocaleString()}
                    </span>
                  )}
                </p>
                <button
                  onClick={() => handleSyncRSS(user.id)}
                  disabled={isSyncing}
                  className={styles.syncButton}
                >
                  {isSyncing ? "Syncing..." : "Sync Now"}
                </button>
              </div>
            )}

            <div className={styles.formGroup}>
              <label>Upload CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => {
                  setCsvFile(e.target.files?.[0] || null);
                  setSelectedUserId(user.id);
                }}
                className={styles.input}
              />
              {csvFile && selectedUserId === user.id && (
                <button
                  onClick={handleUploadCSV}
                  disabled={isUploading}
                  className={styles.saveButton}
                >
                  {isUploading ? "Uploading..." : "Upload CSV"}
                </button>
              )}
            </div>

            {user.goodreadsSources.length === 0 && (
              <div className={styles.formGroup}>
                <label>RSS Feed URL</label>
                <input
                  type="text"
                  value={rssUrl}
                  onChange={(e) => setRssUrl(e.target.value)}
                  placeholder="https://www.goodreads.com/review/list_rss/..."
                  className={styles.input}
                />
                <button
                  onClick={() => handleSaveRSSFeed(user.id)}
                  disabled={isSaving || !rssUrl}
                  className={styles.saveButton}
                >
                  Save RSS Feed
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
