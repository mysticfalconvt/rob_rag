"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";

interface UserActivity {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  conversationCount: number;
  uploadedFileCount: number;
  activeSessionCount: number;
  lastActivity: string | null;
}

export default function AdminDashboardPage() {
  const { user, isLoading, isAdmin } = useAuth();
  const router = useRouter();
  const [activity, setActivity] = useState<UserActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.push("/");
    }
  }, [isLoading, isAdmin, router]);

  useEffect(() => {
    if (isAdmin) {
      loadActivity();
    }
  }, [isAdmin]);

  const loadActivity = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/activity");
      if (res.ok) {
        const data = await res.json();
        setActivity(data);
      } else {
        setError("Failed to load activity");
      }
    } catch (err) {
      setError("Network error loading activity");
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  };

  // Calculate summary stats
  const totalUsers = activity.length;
  const activeUsers = activity.filter((u) => u.isActive).length;
  const totalSessions = activity.reduce(
    (sum, u) => sum + u.activeSessionCount,
    0,
  );
  const totalConversations = activity.reduce(
    (sum, u) => sum + u.conversationCount,
    0,
  );
  const totalFiles = activity.reduce((sum, u) => sum + u.uploadedFileCount, 0);

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
        <h1>Admin Dashboard</h1>
        <button className={styles.refreshButton} onClick={loadActivity}>
          <i className="fas fa-sync-alt"></i> Refresh
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* Summary Stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <i className="fas fa-users"></i>
          </div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{totalUsers}</div>
            <div className={styles.statLabel}>Total Users</div>
            <div className={styles.statSubtext}>{activeUsers} active</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <i className="fas fa-desktop"></i>
          </div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{totalSessions}</div>
            <div className={styles.statLabel}>Active Sessions</div>
            <div className={styles.statSubtext}>
              <Link href="/admin/users">Manage →</Link>
            </div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <i className="fas fa-comments"></i>
          </div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{totalConversations}</div>
            <div className={styles.statLabel}>Conversations</div>
            <div className={styles.statSubtext}>All users</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <i className="fas fa-file-upload"></i>
          </div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{totalFiles}</div>
            <div className={styles.statLabel}>Files Uploaded</div>
            <div className={styles.statSubtext}>By users</div>
          </div>
        </div>
      </div>

      {/* User Activity Table */}
      {loading ? (
        <div className={styles.loading}>Loading activity...</div>
      ) : (
        <div className={styles.activitySection}>
          <h2>User Activity</h2>
          <div className={styles.tableContainer}>
            <table className={styles.activityTable}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Sessions</th>
                  <th>Conversations</th>
                  <th>Files</th>
                  <th>Last Activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className={styles.userCell}>
                        <div className={styles.userName}>{u.name}</div>
                        <div className={styles.userEmail}>{u.email}</div>
                      </div>
                    </td>
                    <td>
                      <div className={styles.statusCell}>
                        {u.isActive ? (
                          <span className={styles.statusActive}>
                            <i className="fas fa-check-circle"></i> Active
                          </span>
                        ) : (
                          <span className={styles.statusInactive}>
                            <i className="fas fa-times-circle"></i> Inactive
                          </span>
                        )}
                        {u.role === "admin" && (
                          <span className={styles.adminBadge}>Admin</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={styles.countBadge}>
                        {u.activeSessionCount}
                      </span>
                    </td>
                    <td>
                      <span className={styles.countBadge}>
                        {u.conversationCount}
                      </span>
                    </td>
                    <td>
                      <span className={styles.countBadge}>
                        {u.uploadedFileCount}
                      </span>
                    </td>
                    <td className={styles.lastActivityCell}>
                      {formatTimeAgo(u.lastActivity)}
                    </td>
                    <td>
                      <Link href="/admin/users" className={styles.manageButton}>
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
