"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "../config/page.module.css";
import Card from "../../components/Card";

interface ScheduledTask {
  id: string;
  type: string;
  name: string;
  schedule: string;
  enabled: boolean;
  query?: string;
  matrixRoomId?: string;
  syncSource?: string;
  lastRun?: string;
  lastRunStatus?: string;
  lastRunError?: string;
  nextRun?: string;
  executions?: TaskExecution[];
}

interface TaskExecution {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  error?: string;
  response?: string;
}

interface MatrixRoom {
  id: string;
  roomId: string;
  name: string;
  description?: string;
  enabled: boolean;
}

export default function ScheduledPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [executions, setExecutions] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<ScheduledTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [message, setMessage] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [tasksRes, executionsRes, upcomingRes] = await Promise.all([
        fetch("/api/scheduled/tasks"),
        fetch("/api/scheduled/executions?limit=20"),
        fetch("/api/scheduled/upcoming?hours=48"),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.tasks || []);
      }

      if (executionsRes.ok) {
        const data = await executionsRes.json();
        setExecutions(data.executions || []);
      }

      if (upcomingRes.ok) {
        const data = await upcomingRes.json();
        setUpcoming(data.tasks || []);
      }
    } catch (error) {
      console.error("Error fetching scheduled tasks:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleTask = async (taskId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`/api/scheduled/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });

      if (res.ok) {
        await fetchData();
        setMessage(`✅ Task ${!currentEnabled ? "enabled" : "disabled"}`);
      } else {
        setMessage("❌ Failed to update task");
      }
    } catch (error) {
      setMessage("❌ Failed to update task");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Delete this scheduled task?")) {
      return;
    }

    try {
      const res = await fetch(`/api/scheduled/tasks/${taskId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await fetchData();
        setMessage("✅ Task deleted");
      } else {
        setMessage("❌ Failed to delete task");
      }
    } catch (error) {
      setMessage("❌ Failed to delete task");
    }
  };

  const handleRunTask = async (taskId: string) => {
    setMessage("⏳ Running task...");

    try {
      const res = await fetch(`/api/scheduled/tasks/${taskId}/run`, {
        method: "POST",
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === "success") {
          setMessage("✅ Task executed successfully");
        } else {
          setMessage(`❌ Task failed: ${data.error || "Unknown error"}`);
        }
        await fetchData();
      } else {
        setMessage("❌ Failed to run task");
      }
    } catch (error) {
      setMessage("❌ Failed to run task");
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatSchedule = (cron: string): string => {
    // Convert common cron patterns to human-readable format
    const patterns: Record<string, string> = {
      '* * * * *': 'Every minute',
      '0 * * * *': 'Every hour',
      '0 0 * * *': 'Daily at midnight',
      '0 12 * * *': 'Daily at noon',
    };

    if (patterns[cron]) return patterns[cron];

    // Try to parse time from cron
    const parts = cron.split(' ');
    if (parts.length >= 5) {
      const minute = parts[0];
      const hour = parts[1];
      const dayOfMonth = parts[2];
      const month = parts[3];
      const dayOfWeek = parts[4];

      // Daily at specific time
      if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && hour !== '*') {
        const h = parseInt(hour);
        const m = parseInt(minute);
        const time = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        return `Daily at ${time}`;
      }

      // Weekly on specific day
      if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const day = days[parseInt(dayOfWeek)] || dayOfWeek;
        const h = parseInt(hour);
        const m = parseInt(minute);
        const time = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        return `${day}s at ${time}`;
      }
    }

    return cron;
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const isOneTimeTask = (schedule: string): boolean => {
    const cronParts = schedule.trim().split(/\s+/);
    if (cronParts.length >= 5) {
      const dayOfMonth = cronParts[2];
      const month = cronParts[3];
      return /^\d+$/.test(dayOfMonth) && /^\d+$/.test(month);
    }
    return false;
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <h1>Scheduled Tasks</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1>Scheduled Tasks & Reminders</h1>

      {message && (
        <div
          style={{
            marginBottom: "20px",
            padding: "12px",
            background: message.includes("✅") ? "#d4edda" : "#f8d7da",
            border: `1px solid ${message.includes("✅") ? "#c3e6cb" : "#f5c6cb"}`,
            borderRadius: "4px",
          }}
        >
          {message}
        </div>
      )}

      {/* Upcoming Executions */}
      <Card title="Upcoming Executions (Next 48 Hours)">
        {upcoming.length === 0 ? (
          <p>No scheduled executions in the next 48 hours.</p>
        ) : (
          <div style={{ marginTop: "16px" }}>
            {upcoming.map((task) => (
              <div
                key={task.id}
                style={{
                  padding: "12px",
                  marginBottom: "8px",
                  border: "1px solid #333",
                  borderRadius: "6px",
                  background: "#2a2a2a",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong style={{ color: "var(--text-color)" }}>{task.name}</strong>
                    <div style={{ fontSize: "0.9em", color: "var(--text-secondary)", marginTop: "4px" }}>
                      📬 Reminder • Next run: {formatDate(task.nextRun)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRunTask(task.id)}
                    style={{
                      padding: "6px 12px",
                      fontSize: "0.9em",
                      background: "#10b981",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Run Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Active Tasks */}
      <Card title="All Scheduled Tasks">
        <div style={{ marginBottom: "16px", display: "flex", gap: "12px", alignItems: "center" }}>
          <button
            onClick={() => setShowCreateDialog(true)}
            style={{
              padding: "10px 16px",
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500",
            }}
          >
            + Create New Task
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />
            <span>Show completed one-time tasks</span>
          </label>
        </div>

        {tasks.filter(task => {
          // Filter out disabled one-time tasks unless showCompleted is true
          if (!showCompleted && !task.enabled && isOneTimeTask(task.schedule) && task.lastRun) {
            return false; // Hide completed one-time tasks
          }
          return true;
        }).length === 0 ? (
          <p>No scheduled tasks yet. Create one to get started!</p>
        ) : (
          <table style={{ width: "100%", marginTop: "16px" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "left" }}>Name</th>
                <th style={{ textAlign: "left" }}>Type</th>
                <th style={{ textAlign: "left" }}>Schedule</th>
                <th style={{ textAlign: "left" }}>Last Run</th>
                <th style={{ textAlign: "left" }}>Next Run</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.filter(task => {
                // Filter out disabled one-time tasks unless showCompleted is true
                if (!showCompleted && !task.enabled && isOneTimeTask(task.schedule) && task.lastRun) {
                  return false; // Hide completed one-time tasks
                }
                return true;
              }).map((task) => (
                <tr key={task.id} style={{ borderTop: "1px solid var(--border-color)" }}>
                  <td style={{ padding: "8px" }}>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: "12px",
                        background: task.enabled ? "#10b981" : "#6b7280",
                        color: "white",
                        fontSize: "0.75em",
                        fontWeight: "600",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {task.enabled ? "Active" : "Paused"}
                    </span>
                  </td>
                  <td style={{ padding: "8px" }}>
                    <div style={{ fontWeight: "500" }}>{task.name}</div>
                    {isOneTimeTask(task.schedule) && (
                      <span style={{ fontSize: "0.8em", color: "var(--text-secondary)", fontStyle: "italic" }}>
                        (one-time)
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "8px", fontSize: "0.9em" }}>
                    📬 Matrix Reminder
                  </td>
                  <td style={{ padding: "8px", fontSize: "0.9em" }}>
                    <div style={{ fontWeight: "500" }}>{formatSchedule(task.schedule)}</div>
                    <div style={{ fontSize: "0.8em", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                      {task.schedule}
                    </div>
                  </td>
                  <td style={{ padding: "8px", fontSize: "0.9em" }}>
                    {task.lastRun ? (
                      <>
                        {formatDate(task.lastRun)}
                        <br />
                        <span
                          style={{
                            color: task.lastRunStatus === "success" ? "green" : "red",
                          }}
                        >
                          {task.lastRunStatus === "success" ? "✓" : "✗"}
                        </span>
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td style={{ padding: "8px", fontSize: "0.9em" }}>
                    {formatDate(task.nextRun)}
                  </td>
                  <td style={{ padding: "8px", textAlign: "right" }}>
                    <button
                      onClick={() => setEditingTask(task)}
                      style={{
                        fontSize: "0.85em",
                        padding: "6px 12px",
                        marginRight: "4px",
                        background: "#3b82f6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                      title="Edit task"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleTask(task.id, task.enabled)}
                      style={{
                        fontSize: "0.85em",
                        padding: "6px 12px",
                        marginRight: "4px",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                      title={task.enabled ? "Pause task" : "Resume task"}
                    >
                      {task.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      onClick={() => handleRunTask(task.id)}
                      style={{
                        fontSize: "0.85em",
                        padding: "6px 12px",
                        marginRight: "4px",
                        background: "#10b981",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                      title="Run task now"
                    >
                      Run Now
                    </button>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      style={{
                        fontSize: "0.85em",
                        padding: "6px 12px",
                        background: "#ef4444",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                      title="Delete task"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Execution History */}
      <Card title="Recent Executions">
        {executions.length === 0 ? (
          <p>No execution history yet.</p>
        ) : (
          <div style={{ marginTop: "16px" }}>
            {executions.map((exec: any) => (
              <div
                key={exec.id}
                style={{
                  padding: "12px",
                  marginBottom: "8px",
                  border: "1px solid #333",
                  borderRadius: "6px",
                  background: exec.status === "success" ? "#1a3a2e" : "#3a1a1a",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: "bold", color: "var(--text-color)" }}>
                      {exec.status === "success" ? "✓" : "✗"} {exec.task.name}
                    </div>
                    <div style={{ fontSize: "0.9em", color: "var(--text-secondary)", marginTop: "4px" }}>
                      {formatDate(exec.startedAt)} • Duration: {formatDuration(exec.duration)}
                    </div>
                    {exec.error && (
                      <div
                        style={{
                          fontSize: "0.85em",
                          color: "#f87171",
                          marginTop: "4px",
                          fontFamily: "monospace",
                        }}
                      >
                        Error: {exec.error}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Create/Edit Task Dialog */}
      {(showCreateDialog || editingTask) && (
        <CreateTaskDialog
          task={editingTask}
          onClose={() => {
            setShowCreateDialog(false);
            setEditingTask(null);
          }}
          onSuccess={() => {
            setShowCreateDialog(false);
            setEditingTask(null);
            fetchData();
            setMessage(editingTask ? "✅ Task updated successfully" : "✅ Task created successfully");
          }}
        />
      )}
    </div>
  );
}

// Create/Edit task dialog component
function CreateTaskDialog({
  task,
  onClose,
  onSuccess,
}: {
  task?: ScheduledTask | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [type, setType] = useState<"matrix_reminder">(
    (task?.type as "matrix_reminder") || "matrix_reminder"
  );
  const [name, setName] = useState(task?.name || "");
  const [schedule, setSchedule] = useState(task?.schedule || "0 7 * * *");
  const [query, setQuery] = useState(task?.query || "");
  const [matrixRoomId, setMatrixRoomId] = useState(task?.matrixRoomId || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [rooms, setRooms] = useState<MatrixRoom[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const body: any = {
        type,
        name,
        schedule,
        enabled: task?.enabled ?? true,
        query,
        matrixRoomId,
      };

      const url = task ? `/api/scheduled/tasks/${task.id}` : "/api/scheduled/tasks";
      const method = task ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.error || `Failed to ${task ? "update" : "create"} task`);
      }
    } catch (err) {
      setError(`Failed to ${task ? "update" : "create"} task`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#1a1a1a",
          padding: "24px",
          borderRadius: "8px",
          maxWidth: "500px",
          width: "90%",
          maxHeight: "90vh",
          overflow: "auto",
          border: "1px solid #333",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.8)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, color: "var(--text-color)" }}>
          {task ? "Edit Scheduled Task" : "Create Scheduled Task"}
        </h2>

        <form onSubmit={handleSubmit}>
          <input type="hidden" value="matrix_reminder" />

          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", marginBottom: "4px", color: "var(--text-color)" }}>Name:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Daily calendar summary"
              required
              style={{
                width: "100%",
                padding: "10px",
                background: "#2a2a2a",
                color: "#e0e0e0",
                border: "1px solid #444",
                borderRadius: "6px",
                fontSize: "14px",
              }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", marginBottom: "4px", color: "var(--text-color)" }}>
              Schedule (cron expression):
            </label>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 7 * * *"
              required
              style={{
                width: "100%",
                padding: "10px",
                fontFamily: "monospace",
                background: "#2a2a2a",
                color: "#e0e0e0",
                border: "1px solid #444",
                borderRadius: "6px",
                fontSize: "14px",
              }}
            />
            <small style={{ color: "var(--text-secondary)" }}>Examples: 0 7 * * * (daily 7am), 0 */4 * * * (every 4 hours)</small>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", marginBottom: "4px", color: "var(--text-color)" }}>Query:</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What's on my calendar today?"
              required
              rows={3}
              style={{
                width: "100%",
                padding: "10px",
                background: "#2a2a2a",
                color: "#e0e0e0",
                border: "1px solid #444",
                borderRadius: "6px",
                fontSize: "14px",
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", marginBottom: "4px", color: "var(--text-color)" }}>
              Matrix Room:
            </label>
            {isLoadingRooms ? (
              <div style={{ padding: "10px", color: "#999" }}>Loading rooms...</div>
            ) : rooms.length === 0 ? (
              <div style={{ padding: "10px", color: "#999" }}>
                No Matrix rooms found. Please configure Matrix and join some rooms first.
              </div>
            ) : (
              <select
                value={matrixRoomId}
                onChange={(e) => setMatrixRoomId(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "#2a2a2a",
                  color: "#e0e0e0",
                  border: "1px solid #444",
                  borderRadius: "6px",
                  fontSize: "14px",
                }}
              >
                <option value="">Select a room...</option>
                {rooms.filter(r => r.enabled).map((room) => (
                  <option key={room.roomId} value={room.roomId}>
                    {room.name} ({room.roomId})
                  </option>
                ))}
              </select>
            )}
            <small style={{ display: "block", marginTop: "4px", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              Select the Matrix room where reminders will be sent
            </small>
          </div>

          {error && (
            <div
              style={{
                marginBottom: "16px",
                padding: "8px",
                background: "#7f1d1d",
                border: "1px solid #991b1b",
                borderRadius: "4px",
                color: "#fecaca",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                background: "transparent",
                color: "var(--text-color)",
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: "8px 16px",
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              {isSubmitting ? (task ? "Updating..." : "Creating...") : (task ? "Update Task" : "Create Task")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
