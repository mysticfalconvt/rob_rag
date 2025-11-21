'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './page.module.css';

interface FileData {
    fileName: string;
    filePath: string;
    fileType: string;
    content: string;
    metadata: {
        size: number;
        lastModified: string;
        chunkCount: number;
        lastIndexed: string;
    };
}

export default function FileViewerPage() {
    const params = useParams();
    const [fileData, setFileData] = useState<FileData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchFile = async () => {
            try {
                const pathArray = Array.isArray(params.path) ? params.path : [params.path];
                const response = await fetch(`/api/files/${pathArray.join('/')}`);

                if (!response.ok) {
                    throw new Error('Failed to fetch file');
                }

                const data = await response.json();
                setFileData(data);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setIsLoading(false);
            }
        };

        fetchFile();
    }, [params.path]);

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loading}>
                    <i className="fas fa-spinner fa-spin fa-2x"></i>
                    <p>Loading file...</p>
                </div>
            </div>
        );
    }

    if (error || !fileData) {
        return (
            <div className={styles.container}>
                <div className={styles.error}>
                    <i className="fas fa-exclamation-triangle fa-2x"></i>
                    <p>{error || 'File not found'}</p>
                </div>
            </div>
        );
    }

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.titleSection}>
                    <i className={`fas fa-file-alt ${styles.icon}`}></i>
                    <h1>{fileData.fileName}</h1>
                </div>

                <div className={styles.metadata}>
                    <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Type:</span>
                        <span className={styles.metadataValue}>{fileData.fileType.toUpperCase()}</span>
                    </div>
                    <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Size:</span>
                        <span className={styles.metadataValue}>{formatFileSize(fileData.metadata.size)}</span>
                    </div>
                    <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Chunks:</span>
                        <span className={styles.metadataValue}>{fileData.metadata.chunkCount}</span>
                    </div>
                    <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Last Modified:</span>
                        <span className={styles.metadataValue}>{formatDate(fileData.metadata.lastModified)}</span>
                    </div>
                    <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Last Indexed:</span>
                        <span className={styles.metadataValue}>{formatDate(fileData.metadata.lastIndexed)}</span>
                    </div>
                </div>
            </div>

            <div className={styles.content}>
                {fileData.fileType === 'md' || fileData.fileType === 'markdown' ? (
                    <div className={styles.markdown}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{fileData.content}</ReactMarkdown>
                    </div>
                ) : (
                    <pre className={styles.plainText}>{fileData.content}</pre>
                )}
            </div>
        </div>
    );
}
