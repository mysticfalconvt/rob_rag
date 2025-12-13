"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";

interface LLMCall {
  id: string;
  callType: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  duration: number;
  tokensPerSecond: number;
  callPayload?: string | null;
  error?: string;
  createdAt: string;
}

interface LLMRequest {
  id: string;
  conversationId?: string;
  messageId?: string;
  userId?: string;
  requestType: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  duration: number;
  tokensPerSecond: number;
  requestPayload: string;
  error?: string;
  createdAt: string;
  calls: LLMCall[];
}

interface Metrics {
  requests: LLMRequest[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  aggregates: {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalDuration: number;
    avgPromptTokens: number;
    avgCompletionTokens: number;
    avgTokens: number;
    avgDuration: number;
    avgTokensPerSecond: string;
  };
  breakdowns: {
    byCallType: Array<{
      callType: string;
      count: number;
      totalTokens: number;
      totalDuration: number;
      avgTokensPerSecond: string;
    }>;
    byModel: Array<{
      model: string;
      count: number;
      totalTokens: number;
      totalDuration: number;
      avgTokensPerSecond: string;
    }>;
    byRequestType: Array<{
      requestType: string;
      count: number;
      totalTokens: number;
    }>;
  };
  timeSeries: Array<{
    time: string;
    count: number;
    tokens: number;
  }>;
}

export default function LLMAnalyticsPage() {
  const { user, isLoading, isAdmin } = useAuth();
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [timeRange, setTimeRange] = useState("7d");
  const [page, setPage] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState<LLMRequest | null>(null);
  const [expandedPayload, setExpandedPayload] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.push("/");
    }
  }, [isLoading, isAdmin, router]);

  useEffect(() => {
    if (isAdmin) {
      loadMetrics();
    }
  }, [isAdmin, timeRange, page]);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `/api/admin/llm-metrics?timeRange=${timeRange}&page=${page}&limit=20`
      );
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      } else {
        setError("Failed to load metrics");
      }
    } catch (err) {
      setError("Network error loading metrics");
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
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
        <h1>LLM Analytics</h1>
        <Link href="/admin/dashboard" className={styles.backLink}>
          ← Back to Dashboard
        </Link>
      </div>

      <div className={styles.controls}>
        <div className={styles.timeRangeSelector}>
          <label>Time Range:</label>
          <select
            value={timeRange}
            onChange={(e) => {
              setTimeRange(e.target.value);
              setPage(1);
            }}
          >
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
        <button className={styles.refreshButton} onClick={loadMetrics}>
          Refresh
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>Loading metrics...</div>
      ) : metrics ? (
        <>
          {/* Summary Cards */}
          <div className={styles.summaryCards}>
            <div className={styles.card}>
              <h3>Total Requests</h3>
              <div className={styles.value}>
                {formatNumber(metrics.aggregates.totalRequests)}
              </div>
            </div>
            <div className={styles.card}>
              <h3>Total Tokens</h3>
              <div className={styles.value}>
                {formatNumber(metrics.aggregates.totalTokens)}
              </div>
              <div className={styles.subtitle}>
                {formatNumber(metrics.aggregates.totalPromptTokens)} prompt +{" "}
                {formatNumber(metrics.aggregates.totalCompletionTokens)} completion
              </div>
            </div>
            <div className={styles.card}>
              <h3>Avg Tokens/Request</h3>
              <div className={styles.value}>
                {formatNumber(metrics.aggregates.avgTokens)}
              </div>
            </div>
            <div className={styles.card}>
              <h3>Avg Speed</h3>
              <div className={styles.value}>
                {metrics.aggregates.avgTokensPerSecond} tok/s
              </div>
            </div>
            <div className={styles.card}>
              <h3>Avg Duration</h3>
              <div className={styles.value}>
                {formatDuration(metrics.aggregates.avgDuration)}
              </div>
            </div>
          </div>

          {/* Breakdowns */}
          <div className={styles.breakdowns}>
            <div className={styles.breakdown}>
              <h2>By Model</h2>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Requests</th>
                    <th>Total Tokens</th>
                    <th>Avg Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.breakdowns.byModel.map((item) => (
                    <tr key={item.model}>
                      <td>{item.model}</td>
                      <td>{formatNumber(item.count)}</td>
                      <td>{formatNumber(item.totalTokens)}</td>
                      <td>{item.avgTokensPerSecond} tok/s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.breakdown}>
              <h2>By Request Type</h2>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Count</th>
                    <th>Total Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.breakdowns.byRequestType.map((item) => (
                    <tr key={item.requestType}>
                      <td>{item.requestType}</td>
                      <td>{formatNumber(item.count)}</td>
                      <td>{formatNumber(item.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.breakdown}>
              <h2>By Call Type</h2>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Count</th>
                    <th>Total Tokens</th>
                    <th>Avg Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.breakdowns.byCallType.map((item) => (
                    <tr key={item.callType}>
                      <td>{item.callType}</td>
                      <td>{formatNumber(item.count)}</td>
                      <td>{formatNumber(item.totalTokens)}</td>
                      <td>{item.avgTokensPerSecond} tok/s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Requests */}
          <div className={styles.recentRequests}>
            <h2>Recent Requests</h2>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Model</th>
                  <th>Tokens In</th>
                  <th>Tokens Out</th>
                  <th>Total</th>
                  <th>Duration</th>
                  <th>Speed</th>
                  <th>Calls</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {metrics.requests.map((req) => (
                  <tr key={req.id} className={req.error ? styles.errorRow : ""}>
                    <td>{formatDate(req.createdAt)}</td>
                    <td>{req.requestType}</td>
                    <td className={styles.modelCell}>{req.model}</td>
                    <td className={styles.tokenColumn}>{formatNumber(req.promptTokens)}</td>
                    <td className={styles.tokenColumn}>{formatNumber(req.completionTokens)}</td>
                    <td className={styles.tokenColumn}>{formatNumber(req.totalTokens)}</td>
                    <td>{formatDuration(req.duration)}</td>
                    <td>{req.tokensPerSecond.toFixed(2)} tok/s</td>
                    <td>{req.calls.length}</td>
                    <td>
                      <button
                        className={styles.detailsButton}
                        onClick={() => setSelectedRequest(req)}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className={styles.pagination}>
              <button
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                className={styles.pageButton}
              >
                Previous
              </button>
              <span>
                Page {page} of {metrics.pagination.totalPages}
              </span>
              <button
                disabled={page >= metrics.pagination.totalPages}
                onClick={() => setPage(page + 1)}
                className={styles.pageButton}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* Request Details Modal */}
      {selectedRequest && (
        <div className={styles.modal} onClick={() => setSelectedRequest(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Request Details</h2>
              <button
                className={styles.closeButton}
                onClick={() => setSelectedRequest(null)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.detailGroup}>
                <strong>Request ID:</strong> {selectedRequest.id}
              </div>
              <div className={styles.detailGroup}>
                <strong>Time:</strong> {formatDate(selectedRequest.createdAt)}
              </div>
              <div className={styles.detailGroup}>
                <strong>Type:</strong> {selectedRequest.requestType}
              </div>
              <div className={styles.detailGroup}>
                <strong>Model:</strong> {selectedRequest.model}
              </div>
              <div className={styles.detailGroup}>
                <strong>Tokens:</strong>
                <div className={styles.tokenBreakdown}>
                  <span className={styles.tokenIn}>
                    ↓ {formatNumber(selectedRequest.promptTokens)} in
                  </span>
                  <span className={styles.tokenOut}>
                    ↑ {formatNumber(selectedRequest.completionTokens)} out
                  </span>
                  <span className={styles.tokenTotal}>
                    = {formatNumber(selectedRequest.totalTokens)} total
                  </span>
                </div>
              </div>
              <div className={styles.detailGroup}>
                <strong>Duration:</strong> {formatDuration(selectedRequest.duration)}
              </div>
              <div className={styles.detailGroup}>
                <strong>Speed:</strong> {selectedRequest.tokensPerSecond.toFixed(2)}{" "}
                tok/s
              </div>
              {selectedRequest.conversationId && (
                <div className={styles.detailGroup}>
                  <strong>Conversation:</strong>{" "}
                  <Link href={`/conversations/${selectedRequest.conversationId}`}>
                    {selectedRequest.conversationId}
                  </Link>
                </div>
              )}
              {selectedRequest.error && (
                <div className={styles.detailGroup}>
                  <strong>Error:</strong>{" "}
                  <span className={styles.errorText}>{selectedRequest.error}</span>
                </div>
              )}

              <h3>Individual Calls ({selectedRequest.calls.length})</h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Model</th>
                    <th>Tokens In</th>
                    <th>Tokens Out</th>
                    <th>Total</th>
                    <th>Duration</th>
                    <th>Speed</th>
                    <th>Details</th>
                    <th>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRequest.calls.map((call) => {
                    let callDetails = "";
                    let payload: any = null;
                    try {
                      if (call.callPayload) {
                        payload = JSON.parse(call.callPayload);
                        if (payload.toolName) {
                          callDetails = `Tool: ${payload.toolName}`;
                        } else if (payload.type) {
                          callDetails = payload.type;
                        }
                        if (payload.decision) {
                          callDetails += ` → ${payload.decision}`;
                        }
                        if (payload.generatedTitle) {
                          callDetails = `"${payload.generatedTitle.substring(0, 50)}"`;
                        }
                        if (payload.selectedTools && payload.selectedTools.length > 0) {
                          callDetails = `Selected: ${payload.selectedTools.join(", ")}`;
                        }
                      }
                    } catch (e) {
                      // Ignore parse errors
                    }

                    return (
                      <tr key={call.id}>
                        <td>{call.callType}</td>
                        <td>{call.model}</td>
                        <td className={styles.tokenColumn}>{formatNumber(call.promptTokens)}</td>
                        <td className={styles.tokenColumn}>{formatNumber(call.completionTokens)}</td>
                        <td className={styles.tokenColumn}>{formatNumber(call.totalTokens)}</td>
                        <td>{formatDuration(call.duration)}</td>
                        <td>{call.tokensPerSecond.toFixed(2)} tok/s</td>
                        <td>{callDetails || "-"}</td>
                        <td>
                          {call.callPayload && (
                            <button
                              className={styles.viewPayloadButton}
                              onClick={() => setExpandedPayload(call.id)}
                              title="View full request/response"
                            >
                              📄
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <h3>Request Payload</h3>
              <pre className={styles.payload}>
                {JSON.stringify(JSON.parse(selectedRequest.requestPayload), null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Payload Detail Modal */}
      {expandedPayload && selectedRequest && (
        <div className={styles.modal} onClick={() => setExpandedPayload(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Call Request/Response</h2>
              <button
                className={styles.closeButton}
                onClick={() => setExpandedPayload(null)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {(() => {
                const call = selectedRequest.calls.find(c => c.id === expandedPayload);
                if (!call || !call.callPayload) return <p>No payload data</p>;

                try {
                  const payload = JSON.parse(call.callPayload);

                  return (
                    <>
                      <div className={styles.detailGroup}>
                        <strong>Call Type:</strong> {call.callType}
                      </div>
                      <div className={styles.detailGroup}>
                        <strong>Model:</strong> {call.model}
                      </div>

                      {payload.request && (
                        <>
                          <h3>Request</h3>
                          <pre className={styles.payload}>
                            {typeof payload.request === 'string'
                              ? payload.request
                              : JSON.stringify(payload.request, null, 2)}
                          </pre>
                        </>
                      )}

                      {payload.response && (
                        <>
                          <h3>Response</h3>
                          <pre className={styles.payload}>
                            {typeof payload.response === 'string'
                              ? payload.response
                              : JSON.stringify(payload.response, null, 2)}
                          </pre>
                        </>
                      )}

                      {payload.args && (
                        <>
                          <h3>Tool Arguments</h3>
                          <pre className={styles.payload}>
                            {JSON.stringify(payload.args, null, 2)}
                          </pre>
                        </>
                      )}

                      <h3>Full Payload</h3>
                      <pre className={styles.payload}>
                        {JSON.stringify(payload, null, 2)}
                      </pre>
                    </>
                  );
                } catch (e) {
                  return <p>Error parsing payload: {e instanceof Error ? e.message : 'Unknown error'}</p>;
                }
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
