'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';

interface IndexedFile {
    id: string;
    filePath: string;
    chunkCount: number;
    lastIndexed: string;
    status: string;
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

    const handleDelete = async (filePath: string) => {
        if (!confirm('Are you sure you want to delete this file index?')) return;

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
                <button
                    onClick={handleScan}
                    disabled={isScanning}
                    className={styles.scanButton}
                >
                    <i className={`fas fa-sync ${isScanning ? 'fa-spin' : ''}`}></i>
                    {isScanning ? 'Scanning...' : 'Scan Now'}
                </button>
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
                                        {file.filePath.split('/').pop()}
                                        <span className={styles.fullPath}>{file.filePath}</span>
                                    </td>
                                    <td>{file.chunkCount}</td>
                                    <td>
                                        <span className={`${styles.status} ${styles[file.status]}`}>
                                            {file.status}
                                        </span>
                                    </td>
                                    <td>{new Date(file.lastIndexed).toLocaleString()}</td>
                                    <td>
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
