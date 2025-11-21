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

interface Settings {
    embeddingModel: string;
    chatModel: string;
    embeddingModelDimension: number;
    isDefault?: boolean;
}

export default function StatusPage() {
    const [status, setStatus] = useState<SystemStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
    const [chatModels, setChatModels] = useState<string[]>([]);
    const [settings, setSettings] = useState<Settings | null>(null);
    const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState('');
    const [selectedChatModel, setSelectedChatModel] = useState('');
    const [isSaving, setIsSaving] = useState(false);

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

    const fetchModels = async () => {
        try {
            const res = await fetch('/api/models');
            if (res.ok) {
                const data = await res.json();
                const allModels = data.models || [];

                // Filter models based on naming conventions
                // Embedding models typically have 'embed' in their name
                const embedModels = allModels.filter((model: string) =>
                    model.toLowerCase().includes('embed')
                );

                // Chat models are typically instruction-tuned (not embedding models)
                const chatModelsList = allModels.filter((model: string) =>
                    !model.toLowerCase().includes('embed')
                );

                setEmbeddingModels(embedModels);
                setChatModels(chatModelsList);
            }
        } catch (error) {
            console.error('Error fetching models:', error);
        }
    };

    const fetchSettings = async () => {
        try {
            const res = await fetch('/api/settings');
            if (res.ok) {
                const data = await res.json();
                setSettings(data);
                setSelectedEmbeddingModel(data.embeddingModel);
                setSelectedChatModel(data.chatModel);
            }
        } catch (error) {
            console.error('Error fetching settings:', error);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchModels();
        fetchSettings();
        const interval = setInterval(fetchStatus, 10000); // Refresh status every 10s
        return () => clearInterval(interval);
    }, []);

    const handleSaveSettings = async () => {
        if (!settings) return;

        const embeddingModelChanged = selectedEmbeddingModel !== settings.embeddingModel;

        if (embeddingModelChanged) {
            const confirmed = confirm(
                '⚠️ Warning: Changing Embedding Model\n\n' +
                'Changing the embedding model will require re-indexing ALL documents.\n' +
                'Different embedding models produce incompatible vector representations.\n\n' +
                'You will need to:\n' +
                '1. Go to the Files page\n' +
                '2. Click "Force Reindex All"\n' +
                '3. Wait for re-indexing to complete\n\n' +
                'Are you sure you want to continue?'
            );

            if (!confirmed) return;
        }

        setIsSaving(true);
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    embeddingModel: selectedEmbeddingModel,
                    chatModel: selectedChatModel,
                    embeddingModelDimension: 1024 // TODO: detect this from model
                })
            });

            if (res.ok) {
                await fetchSettings();
                alert('✅ Settings saved successfully!' + (embeddingModelChanged ? '\n\n⚠️ Remember to re-index all files!' : ''));
            } else {
                alert('❌ Failed to save settings');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            alert('❌ Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    const hasChanges = settings && (
        selectedEmbeddingModel !== settings.embeddingModel ||
        selectedChatModel !== settings.chatModel
    );

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
                    <div className={styles.cardHeader}>
                        <h2>Model Configuration</h2>
                        {settings?.isDefault && (
                            <span className={styles.defaultBadge} title="Using environment variables">Default</span>
                        )}
                    </div>

                    <div className={styles.formGroup}>
                        <label htmlFor="embeddingModel">
                            Embedding Model
                            <span className={styles.warningIcon} title="Changing this requires re-indexing all files">⚠️</span>
                        </label>
                        <select
                            id="embeddingModel"
                            value={selectedEmbeddingModel}
                            onChange={(e) => setSelectedEmbeddingModel(e.target.value)}
                            className={styles.select}
                            disabled={isSaving}
                        >
                            {embeddingModels.length === 0 ? (
                                <option>{settings?.embeddingModel || 'Loading...'}</option>
                            ) : (
                                embeddingModels.map((model: string) => (
                                    <option key={model} value={model}>{model}</option>
                                ))
                            )}
                        </select>
                    </div>

                    <div className={styles.formGroup}>
                        <label htmlFor="chatModel">Chat Model</label>
                        <select
                            id="chatModel"
                            value={selectedChatModel}
                            onChange={(e) => setSelectedChatModel(e.target.value)}
                            className={styles.select}
                            disabled={isSaving}
                        >
                            {chatModels.length === 0 ? (
                                <option>{settings?.chatModel || 'Loading...'}</option>
                            ) : (
                                chatModels.map((model: string) => (
                                    <option key={model} value={model}>{model}</option>
                                ))
                            )}
                        </select>
                    </div>

                    <button
                        onClick={handleSaveSettings}
                        disabled={!hasChanges || isSaving}
                        className={styles.saveButton}
                    >
                        {isSaving ? 'Saving...' : 'Save Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
}
