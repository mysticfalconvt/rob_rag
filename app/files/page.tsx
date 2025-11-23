"use client";

import { useEffect, useState } from "react";
import FilesHeader from "@/components/FilesHeader";
import FileFilterBar from "@/components/FileFilterBar";
import FileTableRow from "@/components/FileTableRow";
import Pagination from "@/components/Pagination";
import styles from "./page.module.css";

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
  goodreadsTitle?: string;
  goodreadsAuthor?: string;
  goodreadsRating?: number | null;
  userName?: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);

  const [showUploaded, setShowUploaded] = useState(true);
  const [showSynced, setShowSynced] = useState(true);
  const [showPaperless, setShowPaperless] = useState(true);
  const [showGoodreads, setShowGoodreads] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const fetchFiles = async () => {
    try {
      const res = await fetch("/api/files");
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      }
    } catch (error) {
      console.error("Error fetching files:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [showUploaded, showSynced, showPaperless, showGoodreads]);

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      if (res.ok) {
        await fetchFiles();
      }
    } catch (error) {
      console.error("Error scanning:", error);
    } finally {
      setIsScanning(false);
    }
  };

  const handleForceReindex = async () => {
    const confirmed = confirm(
      "⚠️ Force Reindex All Files\n\n" +
        "This will clear the entire index and re-scan all documents from scratch.\n" +
        "This may take several minutes depending on the number of files.\n\n" +
        "Are you sure you want to continue?"
    );

    if (!confirmed) return;

    setIsScanning(true);
    try {
      const res = await fetch("/api/reindex", { method: "POST" });
      if (res.ok) {
        await fetchFiles();
        alert("✅ Re-indexing complete!");
      } else {
        alert("❌ Re-indexing failed. Check console for details.");
      }
    } catch (error) {
      console.error("Error force re-indexing:", error);
      alert("❌ Re-indexing failed. Check console for details.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleReindex = async (filePath: string) => {
    setIsScanning(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      if (res.ok) {
        await fetchFiles();
      }
    } catch (error) {
      console.error("Error re-indexing file:", error);
    } finally {
      setIsScanning(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const file = e.target.files[0];
    const formData = new FormData();
    formData.append("file", file);

    setIsScanning(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        await fetchFiles();
      } else {
        console.error("Upload failed");
      }
    } catch (error) {
      console.error("Error uploading file:", error);
    } finally {
      setIsScanning(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (filePath: string) => {
    const isPaperless = filePath.startsWith("paperless://");
    const isUploadedFile = filePath.includes("/File Uploads/");

    let message: string;
    if (isPaperless) {
      message =
        "Are you sure you want to remove this Paperless-ngx document from the index? The document will NOT be deleted from Paperless-ngx.";
    } else if (isUploadedFile) {
      message =
        "Are you sure you want to delete this file? This will remove it from the index AND delete it from the disk.";
    } else {
      message =
        "Are you sure you want to remove this file from the index? The file on disk will NOT be deleted.";
    }

    if (!confirm(message)) return;

    try {
      const res = await fetch(
        `/api/files?path=${encodeURIComponent(filePath)}`,
        {
          method: "DELETE",
        }
      );
      if (res.ok) {
        await fetchFiles();
      }
    } catch (error) {
      console.error("Error deleting file:", error);
    }
  };

  const filteredFiles = files.filter((file) => {
    const isUploaded = file.source === "uploaded";
    const isSynced =
      file.source === "synced" || file.source === "local" || !file.source;
    const isPaperless = file.source === "paperless";
    const isGoodreads = file.source === "goodreads";

    if (isUploaded && !showUploaded) return false;
    if (isSynced && !showSynced) return false;
    if (isPaperless && !showPaperless) return false;
    if (isGoodreads && !showGoodreads) return false;

    return true;
  });

  const totalPages = Math.ceil(filteredFiles.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

  const uploadedCount = files.filter((f) => f.source === "uploaded").length;
  const syncedCount = files.filter(
    (f) => f.source === "synced" || f.source === "local" || !f.source
  ).length;
  const paperlessCount = files.filter((f) => f.source === "paperless").length;
  const goodreadsCount = files.filter((f) => f.source === "goodreads").length;

  return (
    <div className={styles.container}>
      <FilesHeader
        isScanning={isScanning}
        onUpload={handleUpload}
        onScan={handleScan}
        onForceReindex={handleForceReindex}
      />

      <FileFilterBar
        showUploaded={showUploaded}
        showSynced={showSynced}
        showPaperless={showPaperless}
        showGoodreads={showGoodreads}
        uploadedCount={uploadedCount}
        syncedCount={syncedCount}
        paperlessCount={paperlessCount}
        goodreadsCount={goodreadsCount}
        filteredCount={paginatedFiles.length}
        totalCount={filteredFiles.length}
        onToggleUploaded={() => setShowUploaded(!showUploaded)}
        onToggleSynced={() => setShowSynced(!showSynced)}
        onTogglePaperless={() => setShowPaperless(!showPaperless)}
        onToggleGoodreads={() => setShowGoodreads(!showGoodreads)}
      />

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
                <td colSpan={6} className={styles.loading}>
                  Loading...
                </td>
              </tr>
            ) : filteredFiles.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.empty}>
                  {files.length === 0
                    ? "No files indexed yet."
                    : "No files match the current filters."}
                </td>
              </tr>
            ) : (
              paginatedFiles.map((file) => (
                <FileTableRow
                  key={file.id}
                  file={file}
                  isScanning={isScanning}
                  onReindex={handleReindex}
                  onDelete={handleDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}
