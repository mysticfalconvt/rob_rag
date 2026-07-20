"use client";

import { useEffect, useState } from "react";
import Card from "./Card";
import styles from "./GoogleCalendarConfig.module.css"; // Reuse styles

interface MatrixRoom {
  id: string;
  roomId: string;
  name: string;
  description?: string;
  enabled: boolean;
  useRag?: boolean;
  useThreads?: boolean;
  mentionsOnly?: boolean;
  memberCount?: number;
  alias?: string;
  isJoined?: boolean;
}

interface CapabilityInfo {
  key: string;
  label: string;
  description: string;
}

interface PermissionUser {
  userId: string;
  displayName: string;
  rooms: string[];
  /** null = unrestricted (full access); array = exhaustive allowed keys. */
  allowedCapabilities: string[] | null;
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
  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([]);
  const [permUsers, setPermUsers] = useState<PermissionUser[]>([]);
  const [isLoadingPerms, setIsLoadingPerms] = useState(false);
  const [savingUser, setSavingUser] = useState<string | null>(null);

  // Lightweight status-only refresh (does not touch token/other fields, so it's
  // safe to run on a timer while the user may be editing the form).
  const refreshStatus = async () => {
    try {
      const res = await fetch("/api/matrix/config");
      if (res.ok) {
        const data = await res.json();
        setIsRunning(data.isRunning || false);
      }
    } catch (error) {
      // Ignore transient status-poll errors.
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchRooms();
    fetchPermissions();
  }, []);

  // The bot may still be connecting when the page loads (init is triggered by
  // the config fetch above). Poll connection status until it's running so the
  // room/user actions enable on their own — no "Save Configuration" needed.
  useEffect(() => {
    if (isRunning) return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      refreshStatus();
      if (attempts >= 10) clearInterval(id);
    }, 3000);
    return () => clearInterval(id);
  }, [isRunning]);

  // Once connected, (re)load rooms and discovered users.
  useEffect(() => {
    if (!isRunning) return;
    fetchRooms();
    fetchPermissions();
  }, [isRunning]);

  const fetchPermissions = async () => {
    setIsLoadingPerms(true);
    try {
      const res = await fetch("/api/matrix/users");
      if (res.ok) {
        const data = await res.json();
        setCapabilities(data.capabilities || []);
        setPermUsers(data.users || []);
      }
    } catch (error) {
      console.error("Error fetching Matrix user permissions:", error);
    } finally {
      setIsLoadingPerms(false);
    }
  };

  const allCapabilityKeys = capabilities.map((c) => c.key);

  // A user with a null policy is unrestricted → every capability is effectively on.
  const isCapabilityOn = (user: PermissionUser, key: string): boolean =>
    user.allowedCapabilities === null || user.allowedCapabilities.includes(key);

  const savePermissions = async (
    user: PermissionUser,
    allowedCapabilities: string[] | null,
  ) => {
    setSavingUser(user.userId);
    try {
      const res = await fetch("/api/matrix/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matrixUserId: user.userId,
          displayName: user.displayName,
          allowedCapabilities,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPermUsers((prev) =>
          prev.map((u) =>
            u.userId === user.userId
              ? { ...u, allowedCapabilities: data.allowedCapabilities }
              : u,
          ),
        );
      } else {
        alert("Failed to save permissions");
      }
    } catch (error) {
      alert("Failed to save permissions");
    } finally {
      setSavingUser(null);
    }
  };

  const toggleCapability = (user: PermissionUser, key: string) => {
    // Materialize a null (full-access) policy into an explicit list before editing.
    const current =
      user.allowedCapabilities === null
        ? [...allCapabilityKeys]
        : [...user.allowedCapabilities];
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    savePermissions(user, next);
  };

  const resetUserAccess = (user: PermissionUser) => {
    savePermissions(user, null); // null → delete row → full access
  };

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

  const handleToggleRag = async (roomId: string, currentUseRag: boolean) => {
    try {
      const res = await fetch("/api/matrix/rooms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          useRag: !currentUseRag,
        }),
      });

      if (res.ok) {
        await fetchRooms();
      } else {
        alert("Failed to toggle RAG");
      }
    } catch (error) {
      alert("Failed to toggle RAG");
    }
  };

  const patchRoomField = async (
    roomId: string,
    field: "useThreads" | "mentionsOnly",
    value: boolean,
  ) => {
    try {
      const res = await fetch("/api/matrix/rooms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, [field]: value }),
      });
      if (res.ok) {
        await fetchRooms();
      } else {
        alert("Failed to update room");
      }
    } catch (error) {
      alert("Failed to update room");
    }
  };

  const handleRemoveRoom = async (roomId: string) => {
    if (!confirm("Remove this room from tracking?")) {
      return;
    }

    try {
      const res = await fetch(
        `/api/matrix/rooms?roomId=${encodeURIComponent(roomId)}`,
        {
          method: "DELETE",
        },
      );

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
            Bot user access token from Element (Settings → Help & About →
            Advanced → Access Token). Leave blank to keep current token.
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
              <div
                key={index}
                style={{
                  display: "flex",
                  gap: "8px",
                  marginBottom: "4px",
                  alignItems: "center",
                }}
              >
                <code
                  style={{
                    flex: 1,
                    padding: "4px 8px",
                    background: "#f5f5f5",
                    borderRadius: "4px",
                  }}
                >
                  {user}
                </code>
                <button
                  type="button"
                  onClick={() =>
                    setAllowedUsers(allowedUsers.filter((_, i) => i !== index))
                  }
                  style={{
                    padding: "4px 8px",
                    background: "#dc3545",
                    color: "white",
                  }}
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
                if (
                  allowedUserInput.trim() &&
                  !allowedUsers.includes(allowedUserInput.trim())
                ) {
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
            Only these Matrix user IDs will use your RobRAG profile. Others will
            use generic Matrix profile. Example: @rboskind:matrix.rboskind.com
          </small>
        </div>

        <div className={styles.field}>
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={isSaving}
            />{" "}
            Enable Matrix Integration
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3>User Tool Permissions</h3>
          <button
            onClick={fetchPermissions}
            disabled={isLoadingPerms}
            style={{ padding: "8px 16px" }}
          >
            {isLoadingPerms ? "Loading..." : "Refresh Users"}
          </button>
        </div>
        <p style={{ fontSize: "0.9em", color: "#666", marginTop: "4px" }}>
          Users who share a room with the bot. By default everyone has full
          access; uncheck capabilities to restrict someone (e.g. kids shouldn't
          search Paperless documents). Changes save immediately. Admins always
          have full access regardless of these settings.
        </p>

        {permUsers.length === 0 ? (
          <p style={{ color: "#666" }}>
            {isLoadingPerms
              ? "Loading users..."
              : "No users found. Make sure the bot is connected and shares a room with other people, then click Refresh Users."}
          </p>
        ) : (
          permUsers.map((user) => {
            const full = user.allowedCapabilities === null;
            const saving = savingUser === user.userId;
            return (
              <div
                key={user.userId}
                style={{
                  border: "1px solid #e0e0e0",
                  borderRadius: "8px",
                  padding: "12px",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "8px",
                  }}
                >
                  <div>
                    <strong>{user.displayName}</strong>
                    <div>
                      <code style={{ fontSize: "0.85em", color: "#666" }}>
                        {user.userId}
                      </code>
                    </div>
                    {user.rooms.length > 0 && (
                      <div style={{ fontSize: "0.8em", color: "#888" }}>
                        Rooms: {user.rooms.join(", ")}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span
                      style={{
                        fontSize: "0.8em",
                        color: full ? "#2e7d32" : "#b26a00",
                        fontWeight: 600,
                      }}
                    >
                      {full ? "✓ Full access" : "Restricted"}
                    </span>
                    {!full && (
                      <div>
                        <button
                          type="button"
                          onClick={() => resetUserAccess(user)}
                          disabled={saving}
                          style={{
                            marginTop: "4px",
                            padding: "4px 8px",
                            fontSize: "0.8em",
                          }}
                        >
                          Reset to full
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: "4px 12px",
                    marginTop: "8px",
                  }}
                >
                  {capabilities.map((cap) => (
                    <label
                      key={cap.key}
                      title={cap.description}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "0.9em",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isCapabilityOn(user, cap.key)}
                        disabled={saving}
                        onChange={() => toggleCapability(user, cap.key)}
                      />
                      <span>{cap.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className={styles.section} style={{ marginTop: "32px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
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
            <p>
              No rooms yet. Invite the bot to a room or click "Sync Rooms" to
              discover existing rooms.
            </p>
          </div>
        ) : (
          <div className={styles.roomsGrid}>
            {rooms.map((room) => (
              <div key={room.id} className={styles.roomCard}>
                <div className={styles.roomCardHeader}>
                  <div className={styles.roomCardInfo}>
                    <div className={styles.roomCardTitle}>
                      <h4>{room.name}</h4>
                      {room.isJoined ? (
                        <span className={styles.statusJoined}>✓ Joined</span>
                      ) : (
                        <span className={styles.statusNotJoined}>
                          ✗ Not joined
                        </span>
                      )}
                    </div>
                    <p className={styles.roomCardId}>
                      {room.alias || room.roomId}
                    </p>
                    {room.memberCount !== undefined && (
                      <p className={styles.roomCardMembers}>
                        {room.memberCount}{" "}
                        {room.memberCount === 1 ? "member" : "members"}
                      </p>
                    )}
                  </div>
                  <div className={styles.roomCardActions}>
                    <button
                      onClick={() => handleSendTestMessage(room.roomId)}
                      className={styles.testButton}
                      disabled={!room.isJoined}
                    >
                      Test
                    </button>
                    <button
                      onClick={() => handleRemoveRoom(room.roomId)}
                      className={styles.removeButton}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className={styles.roomCardToggles}>
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={room.enabled}
                      onChange={() =>
                        handleToggleRoom(room.roomId, room.enabled)
                      }
                    />
                    <span>Enabled</span>
                  </label>
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={room.useRag ?? true}
                      onChange={() =>
                        handleToggleRag(room.roomId, room.useRag ?? true)
                      }
                      title="Enable RAG for document search"
                    />
                    <span>RAG</span>
                  </label>
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={room.useThreads ?? false}
                      onChange={() =>
                        patchRoomField(
                          room.roomId,
                          "useThreads",
                          !(room.useThreads ?? false),
                        )
                      }
                      title="Reply in a Matrix thread instead of the main timeline"
                    />
                    <span>Threads</span>
                  </label>
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={room.mentionsOnly ?? false}
                      onChange={() =>
                        patchRoomField(
                          room.roomId,
                          "mentionsOnly",
                          !(room.mentionsOnly ?? false),
                        )
                      }
                      title="Only respond when the bot is mentioned"
                    />
                    <span>Mentions only</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: "16px", fontSize: "0.9em", color: "#666" }}>
          <p>
            <strong>To add rooms:</strong> Invite your bot user to a room. The
            bot will automatically join and add it to this list.
          </p>
          <p>
            <strong>Enabled rooms:</strong> The bot will respond to messages in
            enabled rooms.
          </p>
          <p>
            <strong>RAG toggle:</strong> When enabled, the bot searches your
            documents for context. When disabled, the bot uses only the LLM
            without document search. Like in-app chat, #clear clears
            conversation context.
          </p>
          <p>
            <strong>Threads:</strong> When enabled, the bot replies inside a
            Matrix thread (each new message starts its own thread, with its own
            conversation history). Replies to messages already in a thread
            always stay in that thread, regardless of this setting.
          </p>
          <p>
            <strong>Mentions only:</strong> When enabled, the bot ignores
            messages in this room unless it is mentioned (via an @mention or by
            name). Useful for busy rooms. #commands still work.
          </p>
          <p style={{ color: "#d63031" }}>
            <strong>⚠️ Encryption:</strong> Encrypted rooms are not currently
            supported. Please use unencrypted rooms or disable encryption in
            room settings (Security & Privacy → Encryption).
          </p>
        </div>
      </div>
    </Card>
  );
}
