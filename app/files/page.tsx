'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import Link from 'next/link';

interface IndexedFile {
    id: string;
    filePath: string;
    chunkCount: number;
    lastIndexed: string;
    status: string;
    needsReindexing?: boolean;
    fileMissing?: boolean;
}

export default function FilesPage() {
    const [files, setFiles] = useState<IndexedFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isScanning, setIsScanning] = useState(false);

    const fetchFiles = async () => {
        try {
            const res = await fetch('/api/files');
            if (res.ok) {
                const data = await res.json();
                setFiles(data);
            }
        } catch (error) {
            console.error('Error fetching files:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchFiles();
    }, []);

    const handleScan = async () => {
        setIsScanning(true);
        try {
            const res = await fetch('/api/scan', { method: 'POST' });
            if (res.ok) {
                await fetchFiles();
            }
        } catch (error) {
            console.error('Error scanning:', error);
        } finally {
            setIsScanning(false);
        }
    };

    const handleReindex = async (filePath: string) => {
        setIsScanning(true);
        try {
            const res = await fetch('/api/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath }),
            });
            if (res.ok) {
                await fetchFiles();
            }
        } catch (error) {
            console.error('Error re-indexing file:', error);
        } finally {
            setIsScanning(false);
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        const formData = new FormData();
        formData.append('file', file);

        setIsScanning(true);
        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });
            if (res.ok) {
                await fetchFiles();
            } else {
                console.error('Upload failed');
            }
        } catch (error) {
            console.error('Error uploading file:', error);
        } finally {
            setIsScanning(false);
            // Reset input
            e.target.value = '';
        }
    };

    const handleDelete = async (filePath: string) => {
        const isUploadedFile = filePath.includes('/File Uploads/');
        const message = isUploadedFile
            ? 'Are you sure you want to delete this file? This will remove it from the index AND delete it from the disk.'
            : 'Are you sure you want to remove this file from the index? The file on disk will NOT be deleted.';

        if (!confirm(message)) return;

        try {
            const res = await fetch(`/api/files?path=${encodeURIComponent(filePath)}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                await fetchFiles();
            }
        } catch (error) {
            console.error('Error deleting file:', error);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1>Indexed Files</h1>
                <div className={styles.headerActions}>
                    <label className={styles.uploadButton}>
                        <input
                            type="file"
                            onChange={handleUpload}
                            disabled={isScanning}
                            style={{ display: 'none' }}
                        />
                        <i className="fas fa-upload"></i>
                        Upload File
                    </label>
                    <button
                        onClick={handleScan}
                        disabled={isScanning}
                        className={styles.scanButton}
                    >
                        <i className={`fas fa-sync ${isScanning ? 'fa-spin' : ''}`}></i>
                        {isScanning ? 'Scanning...' : 'Scan Now'}
                    </button>
                </div>
            </div>

            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>File Path</th>
                            <th>Chunks</th>
                            <th>Status</th>
                            <th>Last Indexed</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr>
                                <td colSpan={5} className={styles.loading}>Loading...</td>
                            </tr>
                        ) : files.length === 0 ? (
                            <tr>
                                <td colSpan={5} className={styles.empty}>No files indexed yet.</td>
                            </tr>
                        ) : (
                            files.map((file) => (
                                <tr key={file.id}>
                                    <td className={styles.pathCell} title={file.filePath}>
                                        <Link href={`/files${file.filePath}`} className={styles.fileLink}>
                                            {file.filePath.split('/').pop()}
                                        </Link>
                                        <span className={styles.fullPath}>{file.filePath}</span>
                                        {file.fileMissing && (
                                            <span className={styles.missingBadge} title="File not found on disk">Missing</span>
                                        )}
                                    </td>
                                    <td>{file.chunkCount}</td>
                                    <td>
                                        <div className={styles.statusContainer}>
                                            <span className={`${styles.status} ${styles[file.status]}`}>
                                                {file.status}
                                            </span>
                                            {file.needsReindexing && !file.fileMissing && (
                                                <span className={styles.updateBadge} title="File has changed since last index">
                                                    Needs Update
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td>{new Date(file.lastIndexed).toLocaleString()}</td>
                                    <td className={styles.actionsCell}>
                                        {file.needsReindexing && !file.fileMissing && (
                                            <button
                                                onClick={() => handleReindex(file.filePath)}
                                                className={styles.reindexButton}
                                                title="Re-index File"
                                                disabled={isScanning}
                                            >
                                                <i className={`fas fa-sync ${isScanning ? 'fa-spin' : ''}`}></i>
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDelete(file.filePath)}
                                            className={styles.deleteButton}
                                            title="Delete Index"
                                        >
                                            <i className="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
