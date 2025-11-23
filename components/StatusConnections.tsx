"use client";

import styles from "./StatusConnections.module.css";

interface GoodreadsUserStatus {
  id: string;
  name: string;
  email?: string;
  bookCount: number;
  lastSyncedAt?: string;
}

interface ConnectionStatus {
  qdrant: "connected" | "disconnected";
  lmStudio: "connected" | "disconnected";
  paperless: "connected" | "disconnected" | "not_configured" | "disabled";
  goodreads: "connected" | "not_configured";
  goodreadsUsers?: GoodreadsUserStatus[];
}

interface StatusConnectionsProps {
  status: ConnectionStatus;
}

export default function StatusConnections({ status }: StatusConnectionsProps) {
  return (
    <div className={styles.card}>
      <h2>Connections</h2>
      <div className={styles.item}>
        <span>Qdrant Vector DB</span>
        <span className={`${styles.badge} ${styles[status.qdrant]}`}>
          {status.qdrant}
        </span>
      </div>
      <div className={styles.item}>
        <span>LM Studio API</span>
        <span className={`${styles.badge} ${styles[status.lmStudio]}`}>
          {status.lmStudio}
        </span>
      </div>
      <div className={styles.item}>
        <span>Paperless-ngx</span>
        <span className={`${styles.badge} ${styles[status.paperless]}`}>
          {status.paperless.replace("_", " ")}
        </span>
      </div>

      {status.goodreadsUsers && status.goodreadsUsers.length > 0 ? (
        <div className={styles.goodreadsSection}>
          <div className={styles.goodreadsHeader}>
            <span>Goodreads</span>
            <span className={`${styles.badge} ${styles.connected}`}>
              connected
            </span>
          </div>
          <div className={styles.goodreadsUsers}>
            {status.goodreadsUsers.map((user) => (
              <div key={user.id} className={styles.userItem}>
                <div className={styles.userInfo}>
                  <span className={styles.userName}>{user.name}</span>
                  {user.email && (
                    <span className={styles.userEmail}>{user.email}</span>
                  )}
                </div>
                <div className={styles.userStats}>
                  <span className={styles.bookCount}>
                    {user.bookCount} books
                  </span>
                  {user.lastSyncedAt && (
                    <span className={styles.lastSync}>
                      Last sync:{" "}
                      {new Date(user.lastSyncedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.item}>
          <span>Goodreads</span>
          <span className={`${styles.badge} ${styles.not_configured}`}>
            not configured
          </span>
        </div>
      )}
    </div>
  );
}
