"use client";

import { useEffect, useState } from "react";
import FilesHeader from "@/components/FilesHeader";
import FileFilterBar from "@/components/FileFilterBar";
import TagFilter from "@/components/TagFilter";
import BulkTagGeneration from "@/components/BulkTagGeneration";
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
  tags?: string[];
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
  const [showCustomOcr, setShowCustomOcr] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [taggedFilter, setTaggedFilter] = useState<"all" | "tagged" | "untagged">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<
    "source" | "fileName" | "chunkCount" | "status" | "lastIndexed"
  >("lastIndexed");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
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
  }, [showUploaded, showSynced, showPaperless, showGoodreads, showCustomOcr, searchQuery, selectedTags, taggedFilter]);

  const handleSort = (
    column: "source" | "fileName" | "chunkCount" | "status" | "lastIndexed",
  ) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Default to ascending for new column
      setSortColumn(column);
      setSortDirection("asc");
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
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    const needsOcr = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(fileExt || '');

    if (needsOcr) {
      if (!confirm(
        `Upload "${file.name}" for OCR processing?\n\n` +
        `This will:\n` +
        `1. Upload the file\n` +
        `2. Process it with vision OCR\n` +
        `3. Extract text and metadata\n` +
        `4. Index the content for search\n\n` +
        `This may take a few minutes depending on file size.`
      )) {
        e.target.value = "";
        return;
      }
    }

    const formData = new FormData();
    formData.append("file", file);

    setIsScanning(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ocrProcessed) {
          alert(`✅ File uploaded and OCR processed successfully!\n\n${data.message || ''}`);
        }
        await fetchFiles();
      } else {
        const error = await res.json();
        alert(`❌ Upload failed: ${error.details || error.error}`);
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("❌ Error uploading file");
    } finally {
      setIsScanning(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (filePath: string) => {
    const isPaperless = filePath.startsWith("paperless://");
    const isGoodreads = filePath.startsWith("goodreads://");
    const isUploadedOcr = filePath.startsWith("uploaded://");
    const isUploadedFile = filePath.includes("/File Uploads/");

    let message: string;
    if (isPaperless) {
      message =
        "Are you sure you want to remove this Paperless-ngx document from the index? The document will NOT be deleted from Paperless-ngx.";
    } else if (isGoodreads) {
      message =
        "Are you sure you want to remove this Goodreads book from the index? The book data will NOT be deleted from your Goodreads library.";
    } else if (isUploadedOcr) {
      message =
        "Are you sure you want to delete this uploaded document? This will remove it from the index AND delete both the original file and OCR output from disk.";
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
        },
      );
      if (res.ok) {
        await fetchFiles();
      }
    } catch (error) {
      console.error("Error deleting file:", error);
    }
  };

  const handleUseCustomOcr = async (paperlessId: number) => {
    if (
      !confirm(
        `Use Vision OCR for this document?\n\n` +
          `This will:\n` +
          `1. Download the original document from Paperless\n` +
          `2. Process it with a vision-capable LLM for better text extraction\n` +
          `3. Re-index with the improved OCR output\n\n` +
          `This may take a few minutes depending on document size.`,
      )
    ) {
      return;
    }

    setIsScanning(true);
    try {
      const res = await fetch("/api/ocr/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperlessId }),
      });

      if (res.ok) {
        const data = await res.json();
        alert(`✅ OCR processing started! Job ID: ${data.jobId}\n\nThe document will be re-indexed when processing completes.`);
        // Refresh file list to show processing status
        await fetchFiles();
      } else {
        const error = await res.json();
        alert(`❌ Failed to start OCR: ${error.details || error.error}`);
      }
    } catch (error) {
      console.error("Error starting OCR:", error);
      alert("❌ Failed to start OCR process");
    } finally {
      setIsScanning(false);
    }
  };

  const filteredFiles = files
    .filter((file) => {
      const isUploaded = file.source === "uploaded";
      const isSynced =
        file.source === "synced" || file.source === "local" || !file.source;
      const isPaperless = file.source === "paperless";
      const isGoodreads = file.source === "goodreads";
      const isCustomOcr = file.source === "custom_ocr";

      if (isUploaded && !showUploaded) return false;
      if (isSynced && !showSynced) return false;
      if (isPaperless && !showPaperless) return false;
      if (isGoodreads && !showGoodreads) return false;
      if (isCustomOcr && !showCustomOcr) return false;

      // Apply tagged/untagged filter
      if (taggedFilter === "tagged" && (!file.tags || file.tags.length === 0)) {
        return false;
      }
      if (taggedFilter === "untagged" && file.tags && file.tags.length > 0) {
        return false;
      }

      // Apply tag filter (if specific tags selected, file must have at least one)
      if (selectedTags.length > 0) {
        const fileTags = file.tags || [];
        const hasMatchingTag = selectedTags.some((selectedTag) =>
          fileTags.includes(selectedTag),
        );
        if (!hasMatchingTag) return false;
      }

      // Apply search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesPath = file.filePath.toLowerCase().includes(query);
        const matchesTitle =
          file.paperlessTitle?.toLowerCase().includes(query) ||
          file.goodreadsTitle?.toLowerCase().includes(query);
        const matchesAuthor = file.goodreadsAuthor
          ?.toLowerCase()
          .includes(query);
        const matchesTags = file.paperlessTags?.toLowerCase().includes(query);
        const matchesCorrespondent = file.paperlessCorrespondent
          ?.toLowerCase()
          .includes(query);
        const matchesUser = file.userName?.toLowerCase().includes(query);

        if (
          !matchesPath &&
          !matchesTitle &&
          !matchesAuthor &&
          !matchesTags &&
          !matchesCorrespondent &&
          !matchesUser
        ) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortColumn) {
        case "source":
          aValue = a.source || "";
          bValue = b.source || "";
          break;
        case "fileName":
          // Extract filename from path for sorting
          const getFileName = (file: IndexedFile) => {
            if (file.paperlessTitle) return file.paperlessTitle.toLowerCase();
            if (file.goodreadsTitle) return file.goodreadsTitle.toLowerCase();
            // Extract filename from path
            const pathParts = file.filePath.split("/");
            return pathParts[pathParts.length - 1].toLowerCase();
          };
          aValue = getFileName(a);
          bValue = getFileName(b);
          break;
        case "chunkCount":
          aValue = a.chunkCount;
          bValue = b.chunkCount;
          break;
        case "status":
          aValue = a.status;
          bValue = b.status;
          break;
        case "lastIndexed":
          aValue = new Date(a.lastIndexed).getTime();
          bValue = new Date(b.lastIndexed).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

  const totalPages = Math.ceil(filteredFiles.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

  // Helper function to check if a file matches the search query
  const matchesSearch = (file: IndexedFile) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const matchesPath = file.filePath.toLowerCase().includes(query);
    const matchesTitle =
      file.paperlessTitle?.toLowerCase().includes(query) ||
      file.goodreadsTitle?.toLowerCase().includes(query);
    const matchesAuthor = file.goodreadsAuthor?.toLowerCase().includes(query);
    const matchesTags = file.paperlessTags?.toLowerCase().includes(query);
    const matchesCorrespondent = file.paperlessCorrespondent
      ?.toLowerCase()
      .includes(query);
    const matchesUser = file.userName?.toLowerCase().includes(query);

    return (
      matchesPath ||
      matchesTitle ||
      matchesAuthor ||
      matchesTags ||
      matchesCorrespondent ||
      matchesUser
    );
  };

  // Calculate counts based on current search
  const uploadedCount = files.filter(
    (f) => f.source === "uploaded" && matchesSearch(f),
  ).length;
  const syncedCount = files.filter(
    (f) =>
      (f.source === "synced" || f.source === "local" || !f.source) &&
      matchesSearch(f),
  ).length;
  const paperlessCount = files.filter(
    (f) => f.source === "paperless" && matchesSearch(f),
  ).length;
  const goodreadsCount = files.filter(
    (f) => f.source === "goodreads" && matchesSearch(f),
  ).length;
  const customOcrCount = files.filter(
    (f) => f.source === "custom_ocr" && matchesSearch(f),
  ).length;

  return (
    <div className={styles.container}>
      <FilesHeader
        isScanning={isScanning}
        onUpload={handleUpload}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <BulkTagGeneration onComplete={fetchFiles} />

      <TagFilter
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
        taggedFilter={taggedFilter}
        onTaggedFilterChange={setTaggedFilter}
      />

      <FileFilterBar
        showUploaded={showUploaded}
        showSynced={showSynced}
        showPaperless={showPaperless}
        showGoodreads={showGoodreads}
        showCustomOcr={showCustomOcr}
        uploadedCount={uploadedCount}
        syncedCount={syncedCount}
        paperlessCount={paperlessCount}
        goodreadsCount={goodreadsCount}
        customOcrCount={customOcrCount}
        filteredCount={paginatedFiles.length}
        totalCount={filteredFiles.length}
        onToggleUploaded={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr;
          if (allSelected) {
            // If all are selected, select only this one
            setShowUploaded(true);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(false);
          } else {
            // Check if this is the last one selected
            const isLastSelected = showUploaded && !showSynced && !showPaperless && !showGoodreads && !showCustomOcr;
            if (isLastSelected) {
              // Select all instead of deselecting the last one
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
            } else {
              // Otherwise, toggle this one
              setShowUploaded(!showUploaded);
            }
          }
        }}
        onToggleSynced={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(true);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(false);
          } else {
            const isLastSelected = !showUploaded && showSynced && !showPaperless && !showGoodreads && !showCustomOcr;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
            } else {
              setShowSynced(!showSynced);
            }
          }
        }}
        onTogglePaperless={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(false);
            setShowPaperless(true);
            setShowGoodreads(false);
            setShowCustomOcr(false);
          } else {
            const isLastSelected = !showUploaded && !showSynced && showPaperless && !showGoodreads && !showCustomOcr;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
            } else {
              setShowPaperless(!showPaperless);
            }
          }
        }}
        onToggleGoodreads={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(true);
            setShowCustomOcr(false);
          } else {
            const isLastSelected = !showUploaded && !showSynced && !showPaperless && showGoodreads && !showCustomOcr;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
            } else {
              setShowGoodreads(!showGoodreads);
            }
          }
        }}
        onToggleCustomOcr={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(true);
          } else {
            const isLastSelected = !showUploaded && !showSynced && !showPaperless && !showGoodreads && showCustomOcr;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
            } else {
              setShowCustomOcr(!showCustomOcr);
            }
          }
        }}
      />

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th
                onClick={() => handleSort("source")}
                className={styles.sortable}
              >
                Source
                {sortColumn === "source" && (
                  <i
                    className={`fas fa-${sortDirection === "asc" ? "arrow-up" : "arrow-down"}`}
                  />
                )}
              </th>
              <th
                onClick={() => handleSort("fileName")}
                className={styles.sortable}
              >
                File Name
                {sortColumn === "fileName" && (
                  <i
                    className={`fas fa-${sortDirection === "asc" ? "arrow-up" : "arrow-down"}`}
                  />
                )}
              </th>
              <th
                onClick={() => handleSort("chunkCount")}
                className={styles.sortable}
              >
                Chunks
                {sortColumn === "chunkCount" && (
                  <i
                    className={`fas fa-${sortDirection === "asc" ? "arrow-up" : "arrow-down"}`}
                  />
                )}
              </th>
              <th
                onClick={() => handleSort("status")}
                className={styles.sortable}
              >
                Status
                {sortColumn === "status" && (
                  <i
                    className={`fas fa-${sortDirection === "asc" ? "arrow-up" : "arrow-down"}`}
                  />
                )}
              </th>
              <th
                onClick={() => handleSort("lastIndexed")}
                className={styles.sortable}
              >
                Last Indexed
                {sortColumn === "lastIndexed" && (
                  <i
                    className={`fas fa-${sortDirection === "asc" ? "arrow-up" : "arrow-down"}`}
                  />
                )}
              </th>
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
                  onUseCustomOcr={handleUseCustomOcr}
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
