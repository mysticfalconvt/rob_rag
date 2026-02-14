"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import styles from "./GoogleCalendarConfig.module.css";

interface GoogleCalendarConfigProps {
  onSync?: () => void;
}

export default function GoogleCalendarConfig({ onSync }: GoogleCalendarConfigProps) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [calendars, setCalendars] = useState<any[]>([]);
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);
  const [message, setMessage] = useState("");

  // Generate redirect URI immediately (not in useEffect)
  const redirectUri = typeof window !== "undefined"
    ? `${window.location.origin}/api/google/auth/callback`
    : "";

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/google/status");
      if (res.ok) {
        const data = await res.json();
        setIsConfigured(data.configured);
        setIsAuthenticated(data.authenticated);
        setLastSynced(data.lastSynced);
        if (data.calendarIds) {
          setSelectedCalendars(data.calendarIds);
        }

        // If connection validation failed, show appropriate message
        if (data.configured && !data.authenticated && data.connectionError === "auth_expired") {
          setMessage("⚠️ Google Calendar connection expired. Please reconnect.");
        }
      }
    } catch (error) {
      console.error("Error fetching Google Calendar status:", error);
    }
  };

  const handleSaveCredentials = async () => {
    setIsSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/google/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
      });

      if (res.ok) {
        setMessage("✅ Credentials saved! Now click 'Connect to Google' to authenticate.");
        setIsConfigured(true);
      } else {
        const error = await res.json();
        setMessage(`❌ ${error.error || "Failed to save credentials"}`);
      }
    } catch (error) {
      setMessage("❌ Failed to save credentials");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConnectToGoogle = async () => {
    try {
      const res = await fetch("/api/google/auth/login");
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.authUrl;
      } else {
        setMessage("❌ Failed to initiate OAuth");
      }
    } catch (error) {
      setMessage("❌ Failed to connect to Google");
    }
  };

  const handleLoadCalendars = async () => {
    setIsLoadingCalendars(true);
    setMessage("");

    try {
      const res = await fetch("/api/google/calendars");
      if (res.ok) {
        const data = await res.json();
        setCalendars(data.calendars || []);
        setMessage(`✅ Loaded ${data.calendars.length} calendars`);
      } else {
        const error = await res.json();

        // Handle authentication errors specifically
        if (error.authError) {
          setIsAuthenticated(false);
          setMessage(`❌ ${error.error} Click "Reconnect" below.`);
        } else {
          setMessage(`❌ ${error.error || "Failed to load calendars"}`);
        }
      }
    } catch (error) {
      setMessage("❌ Failed to load calendars");
    } finally {
      setIsLoadingCalendars(false);
    }
  };

  const handleToggleCalendar = (calendarId: string) => {
    setSelectedCalendars((prev) =>
      prev.includes(calendarId)
        ? prev.filter((id) => id !== calendarId)
        : [...prev, calendarId]
    );
  };

  const handleSaveCalendarSelection = async () => {
    setIsSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/google/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarIds: selectedCalendars }),
      });

      if (res.ok) {
        setMessage(`✅ Saved ${selectedCalendars.length} calendar(s)`);
      } else {
        const error = await res.json();
        setMessage(`❌ ${error.error || "Failed to save selection"}`);
      }
    } catch (error) {
      setMessage("❌ Failed to save calendar selection");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setMessage("");

    try {
      const res = await fetch("/api/google/sync", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setMessage(
          `✅ Synced ${data.synced.created} new, ${data.synced.updated} updated events. Indexed ${data.indexed} events.`
        );
        setLastSynced(new Date().toISOString());
        if (onSync) onSync();
      } else {
        const error = await res.json();

        // Handle authentication errors specifically
        if (error.authError) {
          setIsAuthenticated(false);
          setMessage(`❌ ${error.error} Click "Reconnect" below.`);
        } else {
          setMessage(`❌ ${error.error || "Sync failed"}`);
        }
      }
    } catch (error) {
      setMessage("❌ Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Google Calendar? This will remove all stored credentials.")) {
      return;
    }

    try {
      const res = await fetch("/api/google/auth/disconnect", { method: "POST" });
      if (res.ok) {
        setMessage("✅ Disconnected from Google Calendar");
        setIsAuthenticated(false);
        setIsConfigured(false);
        setCalendars([]);
        setSelectedCalendars([]);
        setClientId("");
        setClientSecret("");
      } else {
        setMessage("❌ Failed to disconnect");
      }
    } catch (error) {
      setMessage("❌ Failed to disconnect");
    }
  };

  const handleEditCredentials = () => {
    if (confirm("Edit credentials? You'll need to reconnect to Google after saving new credentials.")) {
      setIsConfigured(false);
      setIsAuthenticated(false);
    }
  };

  const handleCopyRedirectUri = () => {
    if (redirectUri) {
      navigator.clipboard.writeText(redirectUri);
      setMessage("✅ Redirect URI copied to clipboard!");
      setTimeout(() => setMessage(""), 3000);
    }
  };

  return (
    <Card title="Google Calendar Integration">
      {message && <div className={styles.message}>{message}</div>}

      {!isConfigured && (
        <>
          <div className={styles.instructionsBox}>
            <h3 className={styles.instructionsTitle}>Setup Instructions</h3>
            <ol className={styles.instructionsList}>
              <li>
                Go to{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  Google Cloud Console → Credentials
                </a>
              </li>
              <li>Create or select a project</li>
              <li>Enable the <strong>Google Calendar API</strong> (APIs & Services → Library)</li>
              <li>Create <strong>OAuth 2.0 Client ID</strong> credentials:
                <ul className={styles.subList}>
                  <li>Application type: <strong>Web application</strong></li>
                  <li>Add the redirect URI below to <strong>Authorized redirect URIs</strong></li>
                </ul>
              </li>
              <li>Copy your Client ID and Client Secret to the form below</li>
            </ol>

            <div className={styles.redirectUriBox}>
              <label className={styles.redirectLabel}>Redirect URI (copy this):</label>
              <div className={styles.redirectUriRow}>
                <input
                  type="text"
                  value={redirectUri}
                  readOnly
                  className={styles.redirectInput}
                />
                <button
                  onClick={handleCopyRedirectUri}
                  className={styles.copyButton}
                  type="button"
                >
                  Copy
                </button>
              </div>
              <small className={styles.helpText}>
                Add this exact URL to your OAuth credentials in Google Cloud Console
              </small>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="googleClientId">Google Client ID</label>
            <input
              id="googleClientId"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789.apps.googleusercontent.com"
              className={styles.input}
              disabled={isSaving}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="googleClientSecret">Google Client Secret</label>
            <input
              id="googleClientSecret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Your Google OAuth Client Secret"
              className={styles.input}
              disabled={isSaving}
            />
          </div>

          <div className={styles.buttonGroup}>
            <button
              onClick={handleSaveCredentials}
              disabled={isSaving || !clientId || !clientSecret}
              className={styles.saveButton}
            >
              {isSaving ? "Saving..." : "Save Credentials"}
            </button>
          </div>
        </>
      )}

      {isConfigured && !isAuthenticated && (
        <>
          <div className={styles.formGroup}>
            <p className={styles.infoText}>
              ✓ Credentials configured. Click below to {message.includes("expired") ? "reconnect" : "authenticate"} with Google:
            </p>
          </div>
          <div className={styles.buttonGroup}>
            <button onClick={handleConnectToGoogle} className={styles.connectButton}>
              {message.includes("expired") ? "Reconnect to Google Calendar" : "Connect to Google Calendar"}
            </button>
            <button onClick={handleEditCredentials} className={styles.secondaryButton}>
              Edit Credentials
            </button>
          </div>
        </>
      )}

      {isAuthenticated && (
        <>
          <div className={styles.statusSection}>
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>Status:</span>
              <span className={styles.statusConnected}>✓ Connected</span>
            </div>
            {lastSynced && (
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Last synced:</span>
                <span className={styles.statusValue}>
                  {new Date(lastSynced).toLocaleString()}
                </span>
              </div>
            )}
            <div className={styles.statusActions}>
              <button onClick={handleEditCredentials} className={styles.editButton}>
                Edit Credentials
              </button>
            </div>
          </div>

          <div className={styles.formGroup}>
            <button
              onClick={handleLoadCalendars}
              disabled={isLoadingCalendars}
              className={styles.secondaryButton}
            >
              {isLoadingCalendars ? "Loading..." : "Load Available Calendars"}
            </button>
          </div>

          {calendars.length > 0 && (
            <>
              <div className={styles.formGroup}>
                <label>Select Calendars to Sync</label>
                <div className={styles.calendarList}>
                  {calendars.map((cal) => (
                    <label key={cal.id} className={styles.calendarItem}>
                      <input
                        type="checkbox"
                        checked={selectedCalendars.includes(cal.id)}
                        onChange={() => handleToggleCalendar(cal.id)}
                      />
                      <span>{cal.summary || cal.id}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={styles.buttonGroup}>
                <button
                  onClick={handleSaveCalendarSelection}
                  disabled={isSaving || selectedCalendars.length === 0}
                  className={styles.saveButton}
                >
                  {isSaving ? "Saving..." : `Save Selection (${selectedCalendars.length})`}
                </button>
              </div>
            </>
          )}

          <div className={styles.buttonGroup}>
            <button
              onClick={handleSync}
              disabled={isSyncing || selectedCalendars.length === 0}
              className={styles.syncButton}
            >
              {isSyncing ? "Syncing..." : "Sync & Index Calendar Events"}
            </button>
          </div>

          <div className={styles.formGroup}>
            <button onClick={handleDisconnect} className={styles.dangerButton}>
              Disconnect Google Calendar
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
