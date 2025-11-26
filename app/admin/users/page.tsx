"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

interface Session {
  id: string;
  createdAt: string;
  lastActive: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  _count: { messages: number };
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  userName: string | null;
  userBio: string | null;
  createdAt: string;
  updatedAt: string;
  conversationCount: number;
  uploadedFileCount: number;
  sessions?: Session[];
  conversations?: Conversation[];
}

export default function UserManagementPage() {
  const { user, isLoading, isAdmin } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string>("");
  const [resetPasswordUserName, setResetPasswordUserName] =
    useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [expandedConversationsUserId, setExpandedConversationsUserId] =
    useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    password: "",
    role: "user",
  });

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.push("/");
    }
  }, [isLoading, isAdmin, router]);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
    }
  }, [isAdmin]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const [usersRes, sessionsRes] = await Promise.all([
        fetch("/api/auth/users"),
        fetch("/api/admin/sessions"),
      ]);

      if (usersRes.ok && sessionsRes.ok) {
        const usersData = await usersRes.json();
        const sessionsData = await sessionsRes.json();

        // Ensure data is an array
        if (Array.isArray(usersData)) {
          // Group sessions by userId
          const sessionsByUser = sessionsData.reduce(
            (acc: Record<string, Session[]>, session: any) => {
              if (!acc[session.userId]) {
                acc[session.userId] = [];
              }
              acc[session.userId].push(session);
              return acc;
            },
            {},
          );

          // Attach sessions to users (conversations already come from API)
          const usersWithSessions = usersData.map((user: User) => ({
            ...user,
            sessions: sessionsByUser[user.id] || [],
          }));

          setUsers(usersWithSessions);
        } else {
          console.error("Invalid data format:", usersData);
          setError("Invalid data format received");
          setUsers([]);
        }
      } else {
        const errorData = await usersRes.json().catch(() => ({}));
        setError(errorData.error || "Failed to load users");
        setUsers([]);
      }
    } catch (err) {
      console.error("Error loading users:", err);
      setError("Network error loading users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setShowCreateModal(false);
        setFormData({ email: "", name: "", password: "", role: "user" });
        await loadUsers();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create user");
      }
    } catch (err) {
      setError("Network error creating user");
    }
  };

  const handleToggleActive = async (userId: string, currentStatus: boolean) => {
    try {
      const res = await fetch(`/api/auth/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentStatus }),
      });

      if (res.ok) {
        await loadUsers();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update user");
      }
    } catch (err) {
      setError("Network error updating user");
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete user "${userName}"? This will also delete all their conversations.`,
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/auth/users/${userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await loadUsers();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to delete user");
      }
    } catch (err) {
      setError("Network error deleting user");
    }
  };

  const handleOpenResetPassword = (userId: string, userName: string) => {
    setResetPasswordUserId(userId);
    setResetPasswordUserName(userName);
    setNewPassword("");
    setShowResetPasswordModal(true);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    try {
      const res = await fetch(`/api/auth/users/${resetPasswordUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });

      if (res.ok) {
        setShowResetPasswordModal(false);
        setNewPassword("");
        alert(`✅ Password reset successfully for ${resetPasswordUserName}`);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to reset password");
      }
    } catch (err) {
      setError("Network error resetting password");
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm("Are you sure you want to end this session?")) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/sessions?sessionId=${sessionId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await loadUsers();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to delete session");
      }
    } catch (err) {
      setError("Network error deleting session");
    }
  };

  const handleDeleteUserSessions = async (userId: string, userName: string) => {
    if (
      !confirm(
        `Are you sure you want to end all sessions for ${userName}? This will log them out of all devices.`,
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/sessions?userId=${userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const data = await res.json();
        alert(`✅ ${data.message}`);
        await loadUsers();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to delete sessions");
      }
    } catch (err) {
      setError("Network error deleting sessions");
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getBrowserFromUserAgent = (userAgent: string | null) => {
    if (!userAgent) return "Unknown";
    if (userAgent.includes("Chrome")) return "Chrome";
    if (userAgent.includes("Firefox")) return "Firefox";
    if (userAgent.includes("Safari")) return "Safari";
    if (userAgent.includes("Edge")) return "Edge";
    return "Unknown";
  };

  const getOSFromUserAgent = (userAgent: string | null) => {
    if (!userAgent) return "Unknown";
    if (userAgent.includes("Windows")) return "Windows";
    if (userAgent.includes("Mac")) return "macOS";
    if (userAgent.includes("Linux")) return "Linux";
    if (userAgent.includes("Android")) return "Android";
    if (userAgent.includes("iOS")) return "iOS";
    return "Unknown";
  };

  if (isLoading || !isAdmin) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>User Management</h1>
        <button
          className={styles.createButton}
          onClick={() => setShowCreateModal(true)}
        >
          <i className="fas fa-user-plus"></i> Create User
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>Loading users...</div>
      ) : users.length === 0 ? (
        <div className={styles.emptyState}>
          <i className="fas fa-users"></i>
          <p>No users found</p>
        </div>
      ) : (
        <div className={styles.userList}>
          {users.map((u) => (
            <div key={u.id} className={styles.userCard}>
              <div className={styles.userInfo}>
                <div className={styles.userHeader}>
                  <div className={styles.userHeaderLeft}>
                    <h3>{u.name}</h3>
                    <div className={styles.badges}>
                      {u.role === "admin" && (
                        <span className={styles.adminBadge}>Admin</span>
                      )}
                      {!u.isActive && (
                        <span className={styles.inactiveBadge}>Inactive</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.userActions}>
                    <button
                      className={styles.actionButton}
                      onClick={() => handleOpenResetPassword(u.id, u.name)}
                      title="Reset password"
                    >
                      <i className="fas fa-key"></i>
                    </button>
                    <button
                      className={styles.actionButton}
                      onClick={() => handleToggleActive(u.id, u.isActive)}
                      disabled={u.id === user?.id}
                      title={u.isActive ? "Deactivate user" : "Activate user"}
                    >
                      <i
                        className={`fas ${u.isActive ? "fa-user-slash" : "fa-user-check"}`}
                      ></i>
                    </button>
                    <button
                      className={`${styles.actionButton} ${styles.deleteButton}`}
                      onClick={() => handleDeleteUser(u.id, u.name)}
                      disabled={u.id === user?.id}
                      title="Delete user"
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
                <div className={styles.userDetails}>
                  <p>
                    <i className="fas fa-envelope"></i> {u.email}
                  </p>
                  <p>
                    <i className="fas fa-desktop"></i> {u.sessions?.length || 0}{" "}
                    active sessions
                  </p>
                  <p>
                    <i className="fas fa-comments"></i> {u.conversationCount}{" "}
                    conversations
                  </p>
                  <p>
                    <i className="fas fa-file-upload"></i> {u.uploadedFileCount}{" "}
                    files uploaded
                  </p>
                  <p className={styles.timestamp}>
                    Created: {new Date(u.createdAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Sessions Section */}
                {u.sessions && u.sessions.length > 0 && (
                  <div className={styles.sessionsSection}>
                    <div className={styles.sessionsHeader}>
                      <button
                        className={styles.toggleSessions}
                        onClick={() =>
                          setExpandedUserId(
                            expandedUserId === u.id ? null : u.id,
                          )
                        }
                      >
                        <i
                          className={`fas fa-chevron-${expandedUserId === u.id ? "up" : "down"}`}
                        ></i>
                        {expandedUserId === u.id ? "Hide" : "Show"} Sessions (
                        {u.sessions.length})
                      </button>
                      {u.sessions.length > 1 && (
                        <button
                          className={styles.endAllSessionsButton}
                          onClick={() => handleDeleteUserSessions(u.id, u.name)}
                        >
                          <i className="fas fa-sign-out-alt"></i> End All
                        </button>
                      )}
                    </div>

                    {expandedUserId === u.id && (
                      <div className={styles.sessionsList}>
                        {u.sessions.map((session) => (
                          <div key={session.id} className={styles.sessionItem}>
                            <div className={styles.sessionItemInfo}>
                              <div className={styles.sessionDevice}>
                                <i className="fas fa-laptop"></i>
                                <span>
                                  {getBrowserFromUserAgent(session.userAgent)}{" "}
                                  on {getOSFromUserAgent(session.userAgent)}
                                </span>
                              </div>
                              <div className={styles.sessionMeta}>
                                <span>
                                  <i className="fas fa-map-marker-alt"></i>{" "}
                                  {session.ipAddress || "Unknown IP"}
                                </span>
                                <span>
                                  <i className="fas fa-clock"></i>{" "}
                                  {formatTimeAgo(session.lastActive)}
                                </span>
                              </div>
                            </div>
                            <button
                              className={styles.endSessionButton}
                              onClick={() => handleDeleteSession(session.id)}
                              title="End session"
                            >
                              <i className="fas fa-times"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Conversations Section */}
                {u.id !== user?.id &&
                  u.conversations &&
                  u.conversations.length > 0 && (
                    <div className={styles.conversationsSection}>
                      <div className={styles.conversationsHeader}>
                        <button
                          className={styles.toggleConversations}
                          onClick={() =>
                            setExpandedConversationsUserId(
                              expandedConversationsUserId === u.id
                                ? null
                                : u.id,
                            )
                          }
                        >
                          <i
                            className={`fas fa-chevron-${expandedConversationsUserId === u.id ? "up" : "down"}`}
                          ></i>
                          {expandedConversationsUserId === u.id
                            ? "Hide"
                            : "Show"}{" "}
                          Conversations ({u.conversations.length})
                        </button>
                      </div>

                      {expandedConversationsUserId === u.id && (
                        <div className={styles.conversationsList}>
                          {u.conversations.map((conversation) => (
                            <a
                              key={conversation.id}
                              href={`/?conversation=${conversation.id}`}
                              className={styles.conversationItem}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <div className={styles.conversationItemInfo}>
                                <div className={styles.conversationTitle}>
                                  <i className="fas fa-comment"></i>
                                  <span>{conversation.title}</span>
                                </div>
                                <div className={styles.conversationMeta}>
                                  <span>
                                    <i className="fas fa-messages"></i>{" "}
                                    {conversation._count.messages} messages
                                  </span>
                                  <span>
                                    <i className="fas fa-clock"></i>{" "}
                                    {formatTimeAgo(conversation.updatedAt)}
                                  </span>
                                </div>
                              </div>
                              <i className="fas fa-external-link-alt"></i>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className={styles.modal} onClick={() => setShowCreateModal(false)}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Create New User</h2>
            <form onSubmit={handleCreateUser}>
              <div className={styles.field}>
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                  autoFocus
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  required
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  required
                  minLength={8}
                />
                <small>
                  Minimum 8 characters, must include uppercase, lowercase, and
                  number
                </small>
              </div>

              <div className={styles.field}>
                <label htmlFor="role">Role</label>
                <select
                  id="role"
                  value={formData.role}
                  onChange={(e) =>
                    setFormData({ ...formData, role: e.target.value })
                  }
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.submitButton}>
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResetPasswordModal && (
        <div
          className={styles.modal}
          onClick={() => setShowResetPasswordModal(false)}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Reset Password for {resetPasswordUserName}</h2>
            <form onSubmit={handleResetPassword}>
              <div className={styles.field}>
                <label htmlFor="newPassword">New Password</label>
                <input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  autoFocus
                  placeholder="Enter new password"
                />
                <small>
                  Minimum 8 characters, must include uppercase, lowercase, and
                  number
                </small>
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={() => {
                    setShowResetPasswordModal(false);
                    setNewPassword("");
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.submitButton}>
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
