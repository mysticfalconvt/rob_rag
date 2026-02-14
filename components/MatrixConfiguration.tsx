"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import styles from "./GoogleCalendarConfig.module.css"; // Reuse styles

interface MatrixRoom {
  id: string;
  roomId: string;
  name: string;
  description?: string;
  enabled: boolean;
  memberCount?: number;
  alias?: string;
  isJoined?: boolean;
}

export default function MatrixConfiguration() {
  const [homeserver, setHomeserver] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [userId, setUserId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [rooms, setRooms] = useState<MatrixRoom[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [message, setMessage] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [tokenChanged, setTokenChanged] = useState(false);
  const [allowedUsers, setAllowedUsers] = useState<string[]>([]);
  const [allowedUserInput, setAllowedUserInput] = useState("");

  useEffect(() => {
    fetchConfig();
    fetchRooms();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/matrix/config");
      if (res.ok) {
        const data = await res.json();
        setHomeserver(data.homeserver || "");
        // Only set token if we don't have one (to preserve user input)
        if (!tokenChanged) {
          setAccessToken(data.accessToken || ""); // This will be masked
        }
        setUserId(data.userId || "");
        setEnabled(data.enabled || false);
        setIsRunning(data.isRunning || false);
        setAllowedUsers(data.allowedUsers || []);
      }
    } catch (error) {
      console.error("Error fetching Matrix config:", error);
    }
  };

  const fetchRooms = async () => {
    setIsLoadingRooms(true);
    try {
      const res = await fetch("/api/matrix/rooms");
      if (res.ok) {
        const data = await res.json();
        setRooms(data.rooms || []);
      }
    } catch (error) {
      console.error("Error fetching Matrix rooms:", error);
    } finally {
      setIsLoadingRooms(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    setMessage("");

    try {
      const body: any = {
        homeserver,
        enabled,
        allowedUsers,
      };

      // Only include token if user has changed it
      if (tokenChanged && accessToken) {
        body.accessToken = accessToken;
      }

      if (userId) {
        body.userId = userId;
      }

      const res = await fetch("/api/matrix/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setMessage(`✅ ${data.message}`);
        if (data.userId) {
          setUserId(data.userId);
        }
        setTokenChanged(false); // Reset token changed flag
        await fetchConfig();
        await fetchRooms();
      } else {
        const error = await res.json();
        setMessage(`❌ ${error.error || "Failed to save configuration"}`);
        if (error.details) {
          setMessage((prev) => `${prev}\nDetails: ${error.details}`);
        }
      }
    } catch (error) {
      setMessage("❌ Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleRoom = async (roomId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch("/api/matrix/rooms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          enabled: !currentEnabled,
        }),
      });

      if (res.ok) {
        await fetchRooms();
      } else {
        alert("Failed to toggle room");
      }
    } catch (error) {
      alert("Failed to toggle room");
    }
  };

  const handleRemoveRoom = async (roomId: string) => {
    if (!confirm("Remove this room from tracking?")) {
      return;
    }

    try {
      const res = await fetch(`/api/matrix/rooms?roomId=${encodeURIComponent(roomId)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await fetchRooms();
      } else {
        alert("Failed to remove room");
      }
    } catch (error) {
      alert("Failed to remove room");
    }
  };

  const handleSyncRooms = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/matrix/sync", {
        method: "POST",
      });

      if (res.ok) {
        setMessage("✅ Rooms synced successfully!");
        await fetchRooms();
      } else {
        const error = await res.json();
        setMessage(`❌ ${error.error || "Failed to sync rooms"}`);
      }
    } catch (error) {
      setMessage("❌ Failed to sync rooms");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSendTestMessage = async (roomId: string) => {
    const message = prompt("Enter test message:");
    if (!message) return;

    try {
      const res = await fetch("/api/matrix/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, message }),
      });

      if (res.ok) {
        alert("✅ Message sent!");
      } else {
        const error = await res.json();
        alert(`❌ ${error.error || "Failed to send message"}`);
      }
    } catch (error) {
      alert("❌ Failed to send message");
    }
  };

  return (
    <Card title="Matrix Integration">
      <div className={styles.section}>
        <h3>Configuration</h3>

        <div className={styles.field}>
          <label>Homeserver URL:</label>
          <input
            type="text"
            value={homeserver}
            onChange={(e) => setHomeserver(e.target.value)}
            placeholder="https://matrix.org"
            disabled={isSaving}
          />
          <small>Your Matrix homeserver (e.g., https://matrix.org)</small>
        </div>

        <div className={styles.field}>
          <label>Access Token:</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type={showToken ? "text" : "password"}
              value={accessToken}
              onChange={(e) => {
                setAccessToken(e.target.value);
                setTokenChanged(true);
              }}
              placeholder="syt_... (leave blank to keep current)"
              disabled={isSaving}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              style={{ padding: "8px 12px" }}
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
          <small>
            Bot user access token from Element (Settings → Help & About → Advanced → Access Token).
            Leave blank to keep current token.
          </small>
        </div>

        <div className={styles.field}>
          <label>User ID:</label>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="@bot:matrix.org"
            disabled={isSaving}
          />
          <small>Optional: Bot user ID (auto-detected if not provided)</small>
        </div>

        <div className={styles.field}>
          <label>Allowed Matrix Users:</label>
          <div style={{ marginBottom: "8px" }}>
            {allowedUsers.map((user, index) => (
              <div key={index} style={{ display: "flex", gap: "8px", marginBottom: "4px", alignItems: "center" }}>
                <code style={{ flex: 1, padding: "4px 8px", background: "#f5f5f5", borderRadius: "4px" }}>
                  {user}
                </code>
                <button
                  type="button"
                  onClick={() => setAllowedUsers(allowedUsers.filter((_, i) => i !== index))}
                  style={{ padding: "4px 8px", background: "#dc3545", color: "white" }}
                  disabled={isSaving}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={allowedUserInput}
              onChange={(e) => setAllowedUserInput(e.target.value)}
              placeholder="@username:matrix.org"
              disabled={isSaving}
              style={{ flex: 1 }}
              onKeyPress={(e) => {
                if (e.key === "Enter" && allowedUserInput.trim()) {
                  e.preventDefault();
                  if (!allowedUsers.includes(allowedUserInput.trim())) {
                    setAllowedUsers([...allowedUsers, allowedUserInput.trim()]);
                  }
                  setAllowedUserInput("");
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (allowedUserInput.trim() && !allowedUsers.includes(allowedUserInput.trim())) {
                  setAllowedUsers([...allowedUsers, allowedUserInput.trim()]);
                  setAllowedUserInput("");
                }
              }}
              disabled={isSaving || !allowedUserInput.trim()}
              style={{ padding: "8px 12px" }}
            >
              Add
            </button>
          </div>
          <small>
            Only these Matrix user IDs will use your RobRAG profile. Others will use generic Matrix profile.
            Example: @rboskind:matrix.rboskind.com
          </small>
        </div>

        <div className={styles.field}>
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={isSaving}
            />
            {" "}Enable Matrix Integration
          </label>
        </div>

        <div className={styles.field}>
          <strong>Status:</strong>{" "}
          {isRunning ? (
            <span style={{ color: "green" }}>✓ Connected</span>
          ) : (
            <span style={{ color: "red" }}>✗ Disconnected</span>
          )}
        </div>

        <button
          onClick={handleSaveConfig}
          disabled={isSaving || !homeserver}
          style={{ marginTop: "16px" }}
        >
          {isSaving ? "Saving..." : "Save Configuration"}
        </button>

        {message && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px",
              background: message.includes("✅") ? "#d4edda" : "#f8d7da",
              border: `1px solid ${message.includes("✅") ? "#c3e6cb" : "#f5c6cb"}`,
              borderRadius: "4px",
              whiteSpace: "pre-wrap",
            }}
          >
            {message}
          </div>
        )}
      </div>

      <div className={styles.section} style={{ marginTop: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Tracked Rooms</h3>
          <button
            onClick={handleSyncRooms}
            disabled={isSyncing || !isRunning}
            style={{ padding: "8px 16px" }}
          >
            {isSyncing ? "Syncing..." : "Sync Rooms"}
          </button>
        </div>

        {isLoadingRooms ? (
          <p>Loading rooms...</p>
        ) : rooms.length === 0 ? (
          <div>
            <p>No rooms yet. Invite the bot to a room or click "Sync Rooms" to discover existing rooms.</p>
          </div>
        ) : (
          <table style={{ width: "100%", marginTop: "16px" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Room Name</th>
                <th style={{ textAlign: "left" }}>Room ID / Alias</th>
                <th style={{ textAlign: "center" }}>Members</th>
                <th style={{ textAlign: "center" }}>Status</th>
                <th style={{ textAlign: "center" }}>Enabled</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.id} style={{ borderTop: "1px solid #ddd" }}>
                  <td style={{ padding: "8px" }}>{room.name}</td>
                  <td style={{ padding: "8px", fontSize: "0.9em", color: "#666" }}>
                    {room.alias || room.roomId}
                  </td>
                  <td style={{ padding: "8px", textAlign: "center" }}>
                    {room.memberCount || "-"}
                  </td>
                  <td style={{ padding: "8px", textAlign: "center" }}>
                    {room.isJoined ? (
                      <span style={{ color: "green" }}>✓</span>
                    ) : (
                      <span style={{ color: "red" }}>✗</span>
                    )}
                  </td>
                  <td style={{ padding: "8px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={room.enabled}
                      onChange={() => handleToggleRoom(room.roomId, room.enabled)}
                    />
                  </td>
                  <td style={{ padding: "8px", textAlign: "right" }}>
                    <button
                      onClick={() => handleSendTestMessage(room.roomId)}
                      style={{ fontSize: "0.9em", padding: "4px 8px", marginRight: "4px" }}
                      disabled={!room.isJoined}
                    >
                      Test
                    </button>
                    <button
                      onClick={() => handleRemoveRoom(room.roomId)}
                      style={{
                        fontSize: "0.9em",
                        padding: "4px 8px",
                        background: "#dc3545",
                        color: "white",
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: "16px", fontSize: "0.9em", color: "#666" }}>
          <p>
            <strong>To add rooms:</strong> Invite your bot user to a room. The bot will automatically
            join and add it to this list.
          </p>
          <p>
            <strong>Enabled rooms:</strong> The bot will respond to messages in enabled rooms.
          </p>
          <p style={{ color: "#d63031" }}>
            <strong>⚠️ Encryption:</strong> Encrypted rooms are not currently supported. Please use
            unencrypted rooms or disable encryption in room settings (Security & Privacy → Encryption).
          </p>
        </div>
      </div>
    </Card>
  );
}
