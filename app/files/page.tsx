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
    source: string;
    paperlessId?: number;
    paperlessTitle?: string;
    paperlessTags?: string;
    paperlessCorrespondent?: string;
}

export default function FilesPage() {
    const [files, setFiles] = useState<IndexedFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isScanning, setIsScanning] = useState(false);
    
    // Filtering and pagination state
    const [showUploaded, setShowUploaded] = useState(true);
    const [showSynced, setShowSynced] = useState(true);
    const [showPaperless, setShowPaperless] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(20);

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

    const handleForceReindex = async () => {
        const confirmed = confirm(
            '⚠️ Force Reindex All Files\n\n' +
            'This will clear the entire index and re-scan all documents from scratch.\n' +
            'This may take several minutes depending on the number of files.\n\n' +
            'Are you sure you want to continue?'
        );

        if (!confirmed) return;

        setIsScanning(true);
        try {
            const res = await fetch('/api/reindex', { method: 'POST' });
            if (res.ok) {
                await fetchFiles();
                alert('✅ Re-indexing complete!');
            } else {
                alert('❌ Re-indexing failed. Check console for details.');
            }
        } catch (error) {
            console.error('Error force re-indexing:', error);
            alert('❌ Re-indexing failed. Check console for details.');
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
        const isPaperless = filePath.startsWith('paperless://');
        const isUploadedFile = filePath.includes('/File Uploads/');
        
        let message: string;
        if (isPaperless) {
            message = 'Are you sure you want to remove this Paperless-ngx document from the index? The document will NOT be deleted from Paperless-ngx.';
        } else if (isUploadedFile) {
            message = 'Are you sure you want to delete this file? This will remove it from the index AND delete it from the disk.';
        } else {
            message = 'Are you sure you want to remove this file from the index? The file on disk will NOT be deleted.';
        }

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

    // Filter files based on source toggles
    const filteredFiles = files.filter(file => {
        const isUploaded = file.source === 'uploaded';
        const isSynced = file.source === 'synced' || file.source === 'local' || !file.source;
        const isPaperless = file.source === 'paperless';
        
        if (isUploaded && !showUploaded) return false;
        if (isSynced && !showSynced) return false;
        if (isPaperless && !showPaperless) return false;
        
        return true;
    });

    // Pagination logic
    const totalPages = Math.ceil(filteredFiles.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

    // Reset to page 1 when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [showUploaded, showSynced, showPaperless]);

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
                    <button
                        onClick={handleForceReindex}
                        disabled={isScanning}
                        className={styles.forceReindexButton}
                        title="Clear index and re-scan all files"
                    >
                        <i className={`fas fa-redo ${isScanning ? 'fa-spin' : ''}`}></i>
                        Force Reindex All
                    </button>
                </div>
            </div>

            <div className={styles.filterBar}>
                <div className={styles.filterSection}>
                    <span className={styles.filterLabel}>Show:</span>
                    <div className={styles.filterToggles}>
                        <button
                            className={`${styles.filterToggle} ${showUploaded ? styles.active : ''}`}
                            onClick={() => setShowUploaded(!showUploaded)}
                        >
                            <i className="fas fa-upload"></i>
                            Uploaded
                            <span className={styles.count}>
                                ({files.filter(f => f.source === 'uploaded').length})
                            </span>
                        </button>
                        <button
                            className={`${styles.filterToggle} ${showSynced ? styles.active : ''}`}
                            onClick={() => setShowSynced(!showSynced)}
                        >
                            <i className="fas fa-sync"></i>
                            Synced
                            <span className={styles.count}>
                                ({files.filter(f => f.source === 'synced' || f.source === 'local' || !f.source).length})
                            </span>
                        </button>
                        <button
                            className={`${styles.filterToggle} ${showPaperless ? styles.active : ''}`}
                            onClick={() => setShowPaperless(!showPaperless)}
                        >
                            <i className="fas fa-file-archive"></i>
                            Paperless
                            <span className={styles.count}>
                                ({files.filter(f => f.source === 'paperless').length})
                            </span>
                        </button>
                    </div>
                </div>
                <div className={styles.statsSection}>
                    <span className={styles.statsText}>
                        Showing {paginatedFiles.length} of {filteredFiles.length} files
                    </span>
                </div>
            </div>

            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Source</th>
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
                                <td colSpan={6} className={styles.loading}>Loading...</td>
                            </tr>
                        ) : filteredFiles.length === 0 ? (
                            <tr>
                                <td colSpan={6} className={styles.empty}>
                                    {files.length === 0 ? 'No files indexed yet.' : 'No files match the current filters.'}
                                </td>
                            </tr>
                        ) : (
                            paginatedFiles.map((file) => {
                                const isPaperless = file.source === 'paperless';
                                const displayName = isPaperless 
                                    ? file.paperlessTitle || `Document ${file.paperlessId}`
                                    : file.filePath.split('/').pop();
                                
                                let tags: string[] = [];
                                if (isPaperless && file.paperlessTags) {
                                    try {
                                        tags = JSON.parse(file.paperlessTags);
                                    } catch (e) {
                                        console.error('Error parsing tags:', e);
                                    }
                                }

                                return (
                                    <tr key={file.id} className={isPaperless ? styles.paperlessRow : ''}>
                                        <td>
                                            <span className={`${styles.sourceBadge} ${
                                                isPaperless ? styles.paperless : 
                                                file.source === 'uploaded' ? styles.uploaded : 
                                                styles.synced
                                            }`}>
                                                {isPaperless ? '🗂️ Paperless' : 
                                                 file.source === 'uploaded' ? '📤 Uploaded' : 
                                                 '🔄 Synced'}
                                            </span>
                                        </td>
                                        <td className={styles.pathCell}>
                                            {isPaperless ? (
                                                <div>
                                                    <Link href={`/files/${encodeURIComponent(file.filePath)}`} className={styles.fileLink}>
                                                        {displayName}
                                                    </Link>
                                                    {tags.length > 0 && (
                                                        <div className={styles.tags}>
                                                            {tags.map((tag, idx) => (
                                                                <span key={idx} className={styles.tag}>{tag}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {file.paperlessCorrespondent && (
                                                        <div className={styles.correspondent}>
                                                            From: {file.paperlessCorrespondent}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <>
                                                    <Link href={`/files${file.filePath}`} className={styles.fileLink}>
                                                        {displayName}
                                                    </Link>
                                                    <span className={styles.fullPath}>{file.filePath}</span>
                                                    {file.fileMissing && (
                                                        <span className={styles.missingBadge} title="File not found on disk">Missing</span>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                        <td>{file.chunkCount}</td>
                                        <td>
                                            <div className={styles.statusContainer}>
                                                <span className={`${styles.status} ${styles[file.status]}`}>
                                                    {file.status}
                                                </span>
                                                {file.needsReindexing && !file.fileMissing && !isPaperless && (
                                                    <span className={styles.updateBadge} title="File has changed since last index">
                                                        Needs Update
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td>{new Date(file.lastIndexed).toLocaleString()}</td>
                                        <td>
                                            <div className={styles.actionsCell}>
                                                {file.needsReindexing && !file.fileMissing && !isPaperless && (
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
                                                    title={isPaperless ? "Remove from index" : "Delete file"}
                                                >
                                                    <i className="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className={styles.pagination}>
                    <button
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                        className={styles.paginationButton}
                        title="First page"
                    >
                        <i className="fas fa-angle-double-left"></i>
                    </button>
                    
                    <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className={styles.paginationButton}
                    >
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    
                    <div className={styles.paginationNumbers}>
                        {(() => {
                            const pages = [];
                            const showPages = 5; // Number of page buttons to show
                            let startPage = Math.max(1, currentPage - Math.floor(showPages / 2));
                            let endPage = Math.min(totalPages, startPage + showPages - 1);
                            
                            // Adjust start if we're near the end
                            if (endPage - startPage < showPages - 1) {
                                startPage = Math.max(1, endPage - showPages + 1);
                            }
                            
                            // Always show first page
                            if (startPage > 1) {
                                pages.push(
                                    <button
                                        key={1}
                                        onClick={() => setCurrentPage(1)}
                                        className={styles.paginationNumber}
                                    >
                                        1
                                    </button>
                                );
                                if (startPage > 2) {
                                    pages.push(<span key="ellipsis1" className={styles.ellipsis}>...</span>);
                                }
                            }
                            
                            // Show page numbers
                            for (let i = startPage; i <= endPage; i++) {
                                pages.push(
                                    <button
                                        key={i}
                                        onClick={() => setCurrentPage(i)}
                                        className={`${styles.paginationNumber} ${i === currentPage ? styles.active : ''}`}
                                    >
                                        {i}
                                    </button>
                                );
                            }
                            
                            // Always show last page
                            if (endPage < totalPages) {
                                if (endPage < totalPages - 1) {
                                    pages.push(<span key="ellipsis2" className={styles.ellipsis}>...</span>);
                                }
                                pages.push(
                                    <button
                                        key={totalPages}
                                        onClick={() => setCurrentPage(totalPages)}
                                        className={styles.paginationNumber}
                                    >
                                        {totalPages}
                                    </button>
                                );
                            }
                            
                            return pages;
                        })()}
                    </div>
                    
                    <button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className={styles.paginationButton}
                    >
                        <i className="fas fa-chevron-right"></i>
                    </button>
                    
                    <button
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                        className={styles.paginationButton}
                        title="Last page"
                    >
                        <i className="fas fa-angle-double-right"></i>
                    </button>
                </div>
            )}
        </div>
    );
}
