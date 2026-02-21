"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import styles from "./GoogleCalendarConfig.module.css";

interface EmailAccount {
  id: string;
  provider: "gmail" | "zoho";
  email: string;
  label: string | null;
  permissions: string;
  enabled: boolean;
  imapHost: string | null;
  imapPort: number | null;
  lastConnected: string | null;
  connectionError: string | null;
  gmailTokenExpiry: string | null;
  isAuthenticated: boolean;
  hasCredentials: boolean;
}

export default function EmailConfiguration() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Add account form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState<"gmail" | "zoho">("gmail");
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newImapPassword, setNewImapPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Testing state
  const [testingAccountId, setTestingAccountId] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();

    // Check URL for OAuth callback results
    const params = new URLSearchParams(window.location.search);
    if (params.get("email_auth") === "success") {
      setMessage("Gmail connected successfully!");
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("email_auth") === "error") {
      setMessage(`Gmail connection failed: ${params.get("message") || "Unknown error"}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const fetchAccounts = async () => {
    try {
      const res = await fetch("/api/email/accounts");
      if (res.ok) {
        setAccounts(await res.json());
      }
    } catch (error) {
      console.error("Error fetching email accounts:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAccount = async () => {
    if (!newEmail) {
      setMessage("Email address is required.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/email/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: newProvider,
          email: newEmail,
          label: newLabel || null,
          imapPassword: newProvider === "zoho" ? newImapPassword : undefined,
        }),
      });

      if (res.ok) {
        setMessage("Account added successfully!");
        setShowAddForm(false);
        setNewEmail("");
        setNewLabel("");
        setNewImapPassword("");
        await fetchAccounts();
      } else {
        const data = await res.json();
        setMessage(data.error || "Failed to add account.");
      }
    } catch {
      setMessage("Failed to add account.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConnectGmail = async (accountId: string) => {
    try {
      const res = await fetch(`/api/email/auth/gmail/login?accountId=${accountId}`);
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.authUrl;
      } else {
        const data = await res.json();
        setMessage(data.error || "Failed to initiate Gmail OAuth.");
      }
    } catch {
      setMessage("Failed to connect Gmail.");
    }
  };

  const handleTestConnection = async (accountId: string) => {
    setTestingAccountId(accountId);
    setMessage("");

    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });

      const data = await res.json();
      setMessage(data.success ? data.message : `Connection failed: ${data.error}`);
      await fetchAccounts();
    } catch {
      setMessage("Failed to test connection.");
    } finally {
      setTestingAccountId(null);
    }
  };

  const handleToggleEnabled = async (accountId: string, enabled: boolean) => {
    try {
      await fetch(`/api/email/accounts/${accountId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await fetchAccounts();
    } catch {
      setMessage("Failed to update account.");
    }
  };

  const handleUpdatePermissions = async (accountId: string, permissions: string) => {
    try {
      await fetch(`/api/email/accounts/${accountId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      await fetchAccounts();
    } catch {
      setMessage("Failed to update permissions.");
    }
  };

  const handleRemoveAccount = async (accountId: string, email: string) => {
    if (!confirm(`Remove email account ${email}? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/email/accounts/${accountId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setMessage(`Removed ${email}`);
        await fetchAccounts();
      } else {
        setMessage("Failed to remove account.");
      }
    } catch {
      setMessage("Failed to remove account.");
    }
  };

  const handleUpdateImapPassword = async (accountId: string, password: string) => {
    try {
      await fetch(`/api/email/accounts/${accountId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imapPassword: password }),
      });
      setMessage("IMAP password updated.");
      await fetchAccounts();
    } catch {
      setMessage("Failed to update password.");
    }
  };

  if (isLoading) return null;

  return (
    <Card title="Email Integration">
      {message && <div className={styles.message}>{message}</div>}

      {/* Existing accounts */}
      {accounts.length > 0 && (
        <div className={styles.roomsGrid}>
          {accounts.map((account) => (
            <div key={account.id} className={styles.roomCard}>
              <div className={styles.roomCardHeader}>
                <div className={styles.roomCardInfo}>
                  <div className={styles.roomCardTitle}>
                    <h4>{account.label || account.email}</h4>
                    {account.enabled ? (
                      account.isAuthenticated || account.provider === "zoho" ? (
                        <span className={styles.statusJoined}>Connected</span>
                      ) : (
                        <span className={styles.statusNotJoined}>Not authenticated</span>
                      )
                    ) : (
                      <span className={styles.statusNotJoined}>Disabled</span>
                    )}
                  </div>
                  <p className={styles.roomCardId}>
                    {account.provider === "gmail" ? "Gmail" : "Zoho"} &middot; {account.email}
                  </p>
                  {account.lastConnected && (
                    <p className={styles.roomCardMembers}>
                      Last connected: {new Date(account.lastConnected).toLocaleString()}
                    </p>
                  )}
                  {account.connectionError && (
                    <p className={styles.roomCardMembers} style={{ color: "#ef4444" }}>
                      Error: {account.connectionError}
                    </p>
                  )}
                </div>
                <div className={styles.roomCardActions}>
                  {account.provider === "gmail" && !account.isAuthenticated && (
                    <button
                      className={styles.connectButton}
                      onClick={() => handleConnectGmail(account.id)}
                      style={{ padding: "6px 12px", fontSize: "0.875rem" }}
                    >
                      Connect Gmail
                    </button>
                  )}
                  <button
                    className={styles.testButton}
                    onClick={() => handleTestConnection(account.id)}
                    disabled={testingAccountId === account.id}
                  >
                    {testingAccountId === account.id ? "Testing..." : "Test"}
                  </button>
                  <button
                    className={styles.removeButton}
                    onClick={() => handleRemoveAccount(account.id, account.email)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className={styles.roomCardToggles}>
                <label className={styles.toggleLabel}>
                  <input
                    type="checkbox"
                    checked={account.enabled}
                    onChange={(e) => handleToggleEnabled(account.id, e.target.checked)}
                  />
                  <span>Enabled</span>
                </label>

                <label className={styles.toggleLabel}>
                  <span>Permissions:</span>
                  <select
                    value={account.permissions}
                    onChange={(e) => handleUpdatePermissions(account.id, e.target.value)}
                    style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      border: "1px solid #d1d5db",
                      fontSize: "0.875rem",
                      background: "transparent",
                    }}
                  >
                    <option value="read">Read only</option>
                    <option value="read_write">Read & write</option>
                    <option value="read_write_delete">Full access</option>
                  </select>
                </label>
              </div>

              {/* Zoho password update */}
              {account.provider === "zoho" && (
                <ZohoPasswordField
                  accountId={account.id}
                  onUpdate={handleUpdateImapPassword}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {accounts.length === 0 && !showAddForm && (
        <p className={styles.infoText}>
          No email accounts configured. Add one to enable email search and management in chat.
        </p>
      )}

      {/* Add account form */}
      {showAddForm ? (
        <div style={{ marginTop: "1rem" }}>
          <div className={styles.formGroup}>
            <label>Provider</label>
            <select
              value={newProvider}
              onChange={(e) => setNewProvider(e.target.value as "gmail" | "zoho")}
              className={styles.input}
            >
              <option value="gmail">Gmail</option>
              <option value="zoho">Zoho Mail</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Email Address</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Label (optional)</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g., Work Gmail, Personal Zoho"
              className={styles.input}
            />
          </div>

          {newProvider === "zoho" && (
            <div className={styles.formGroup}>
              <label>IMAP App Password</label>
              <input
                type="password"
                value={newImapPassword}
                onChange={(e) => setNewImapPassword(e.target.value)}
                placeholder="Zoho App Password (not your login password)"
                className={styles.input}
              />
              <small className={styles.helpText}>
                Generate an app password in Zoho Settings &gt; Security &gt; App Passwords
              </small>
            </div>
          )}

          {newProvider === "gmail" && (
            <div className={styles.instructionsBox}>
              <p style={{ margin: 0, fontSize: "0.875rem" }}>
                After adding, click &quot;Connect Gmail&quot; to authenticate via OAuth.
                Uses the same Google Client ID/Secret as Calendar integration.
              </p>
            </div>
          )}

          <div className={styles.buttonGroup}>
            <button
              className={styles.saveButton}
              onClick={handleAddAccount}
              disabled={isSaving || !newEmail}
            >
              {isSaving ? "Adding..." : "Add Account"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                setShowAddForm(false);
                setNewEmail("");
                setNewLabel("");
                setNewImapPassword("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.buttonGroup} style={{ marginTop: "1rem" }}>
          <button
            className={styles.connectButton}
            onClick={() => setShowAddForm(true)}
          >
            Add Email Account
          </button>
        </div>
      )}
    </Card>
  );
}

/**
 * Inline component for updating Zoho IMAP password
 */
function ZohoPasswordField({
  accountId,
  onUpdate,
}: {
  accountId: string;
  onUpdate: (id: string, password: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");

  if (!editing) {
    return (
      <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid #e5e7eb" }}>
        <button
          className={styles.testButton}
          onClick={() => setEditing(true)}
        >
          Update IMAP Password
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid #e5e7eb" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New app password"
          className={styles.input}
          style={{ flex: 1 }}
        />
        <button
          className={styles.saveButton}
          style={{ flex: "none", padding: "0.5rem 1rem" }}
          onClick={() => {
            onUpdate(accountId, password);
            setEditing(false);
            setPassword("");
          }}
          disabled={!password}
        >
          Save
        </button>
        <button
          className={styles.secondaryButton}
          style={{ flex: "none", padding: "0.5rem 1rem" }}
          onClick={() => {
            setEditing(false);
            setPassword("");
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
