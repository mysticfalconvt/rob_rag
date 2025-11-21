'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';

interface SystemStatus {
    qdrant: 'connected' | 'disconnected';
    lmStudio: 'connected' | 'disconnected';
    totalFiles: number;
    totalChunks: number;
    config: {
        embeddingModel: string;
        chatModel: string;
    };
}

export default function StatusPage() {
    const [status, setStatus] = useState<SystemStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/status');
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
            }
        } catch (error) {
            console.error('Error fetching status:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 10000); // Refresh every 10s
        return () => clearInterval(interval);
    }, []);

    if (isLoading) return <div className={styles.loading}>Loading status...</div>;
    if (!status) return <div className={styles.error}>Failed to load status.</div>;

    return (
        <div className={styles.container}>
            <h1 className={styles.title}>System Status</h1>

            <div className={styles.grid}>
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
                </div>

                <div className={styles.card}>
                    <h2>Statistics</h2>
                    <div className={styles.stat}>
                        <span className={styles.value}>{status.totalFiles}</span>
                        <span className={styles.label}>Indexed Files</span>
                    </div>
                    <div className={styles.stat}>
                        <span className={styles.value}>{status.totalChunks}</span>
                        <span className={styles.label}>Total Chunks</span>
                    </div>
                </div>

                <div className={styles.card}>
                    <h2>Configuration</h2>
                    <div className={styles.item}>
                        <span>Embedding Model</span>
                        <span className={styles.code}>{status.config.embeddingModel}</span>
                    </div>
                    <div className={styles.item}>
                        <span>Chat Model</span>
                        <span className={styles.code}>{status.config.chatModel}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
