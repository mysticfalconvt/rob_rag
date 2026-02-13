"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import FilesHeader from "@/components/FilesHeader";
import FileFilterBar from "@/components/FileFilterBar";
import TagFilter from "@/components/TagFilter";
import BulkTagGeneration from "@/components/BulkTagGeneration";
import FileTableRow from "@/components/FileTableRow";
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
  eventTitle?: string;
  eventStartTime?: string;
  eventLocation?: string;
  calendarName?: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isScanning, setIsScanning] = useState(false);

  const [showUploaded, setShowUploaded] = useState(true);
  const [showSynced, setShowSynced] = useState(true);
  const [showPaperless, setShowPaperless] = useState(true);
  const [showGoodreads, setShowGoodreads] = useState(true);
  const [showCustomOcr, setShowCustomOcr] = useState(true);
  const [showCalendar, setShowCalendar] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [taggedFilter, setTaggedFilter] = useState<"all" | "tagged" | "untagged">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<
    "source" | "fileName" | "chunkCount" | "status" | "lastIndexed"
  >("lastIndexed");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const tableParentRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef(0);
  const hasInitialized = useRef(false);

  // Cache key for localStorage
  const CACHE_KEY = 'files-cache';
  const CACHE_TIMESTAMP_KEY = 'files-cache-timestamp';
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  const MAX_CACHE_SIZE = 3 * 1024 * 1024; // 3MB max cache size

  // Helper to safely save to localStorage with size check
  const saveToCache = useCallback((data: IndexedFile[]) => {
    try {
      const jsonStr = JSON.stringify(data);
      // Check size before saving (rough estimate)
      if (jsonStr.length > MAX_CACHE_SIZE) {
        console.warn('Cache too large, storing only first 500 files');
        // Store only first 500 files if too large
        const truncated = data.slice(0, 500);
        const truncatedStr = JSON.stringify(truncated);
        localStorage.setItem(CACHE_KEY, truncatedStr);
      } else {
        localStorage.setItem(CACHE_KEY, jsonStr);
      }
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old cache');
        // Clear cache and try again with smaller dataset
        localStorage.removeItem(CACHE_KEY);
        try {
          const truncated = data.slice(0, 300);
          localStorage.setItem(CACHE_KEY, JSON.stringify(truncated));
          localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        } catch (e2) {
          console.error('Failed to cache even truncated data:', e2);
        }
      } else {
        console.error('Failed to save to cache:', e);
      }
    }
  }, [CACHE_KEY, CACHE_TIMESTAMP_KEY, MAX_CACHE_SIZE]);

  // Load from cache on mount
  useEffect(() => {
    // Prevent double initialization (React 19 strict mode)
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const cached = localStorage.getItem(CACHE_KEY);
    const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);

    if (cached && timestamp) {
      const age = Date.now() - parseInt(timestamp);
      if (age < CACHE_DURATION) {
        try {
          const cachedFiles = JSON.parse(cached);
          setFiles(cachedFiles);
          setIsLoading(false);

          // Restore scroll position after a short delay
          const savedScroll = sessionStorage.getItem('files-scroll');
          if (savedScroll && tableParentRef.current) {
            setTimeout(() => {
              if (tableParentRef.current) {
                tableParentRef.current.scrollTop = parseInt(savedScroll);
              }
            }, 50);
          }

          // Check if cache might be incomplete and load more in background
          // If we have exactly a multiple of 100, there might be more files
          if (cachedFiles.length % 100 === 0 && cachedFiles.length > 0) {
            setHasMore(true);
            // Start loading from where cache left off
            setTimeout(() => loadRemainingChunks(cachedFiles.length), 100);
          } else {
            setHasMore(false);
          }
          return;
        } catch (e) {
          console.error('Failed to parse cached files:', e);
        }
      }
    }

    // If no valid cache, fetch normally
    fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Save scroll position when navigating away
  useEffect(() => {
    const saveScroll = () => {
      if (tableParentRef.current) {
        sessionStorage.setItem('files-scroll', tableParentRef.current.scrollTop.toString());
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        saveScroll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', saveScroll);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', saveScroll);
      saveScroll();
    };
  }, []);

  // Fetch a chunk of files
  const fetchFilesChunk = useCallback(async (offset: number, limit: number) => {
    try {
      const res = await fetch(`/api/files?offset=${offset}&limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        return data;
      }
      return [];
    } catch (error) {
      console.error("Error fetching files chunk:", error);
      return [];
    }
  }, []);

  // Initial load - fetch first chunk immediately
  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    const initialChunk = await fetchFilesChunk(0, 100);
    setFiles(initialChunk);
    setIsLoading(false);
    setHasMore(initialChunk.length === 100);

    // Continue loading remaining chunks in background
    if (initialChunk.length === 100) {
      loadRemainingChunks(100);
    }
  }, [fetchFilesChunk]);

  // Load remaining chunks in background
  const loadRemainingChunks = useCallback(async (startOffset: number) => {
    setIsLoadingMore(true);
    let offset = startOffset;
    const chunkSize = 100;
    let hasMoreChunks = true;
    const allChunks: IndexedFile[] = [];

    while (hasMoreChunks) {
      const chunk = await fetchFilesChunk(offset, chunkSize);
      if (chunk.length > 0) {
        allChunks.push(...chunk);
        setFiles((prev) => {
          const updated = [...prev, ...chunk];
          // Save to cache periodically (every 200 files)
          if (allChunks.length % 200 === 0) {
            saveToCache(updated);
          }
          return updated;
        });
        offset += chunk.length;
        hasMoreChunks = chunk.length === chunkSize;

        // Small delay to avoid blocking UI
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        hasMoreChunks = false;
      }
    }

    setHasMore(false);
    setIsLoadingMore(false);

    // Final cache save
    setFiles((prev) => {
      saveToCache(prev);
      return prev;
    });
  }, [fetchFilesChunk, saveToCache]);


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
        // Invalidate cache
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIMESTAMP_KEY);
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
        // Invalidate cache
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIMESTAMP_KEY);
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
        // Invalidate cache
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIMESTAMP_KEY);
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
        // Invalidate cache and refresh file list to show processing status
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIMESTAMP_KEY);
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
      const isCalendar = file.source === "google-calendar";

      if (isUploaded && !showUploaded) return false;
      if (isSynced && !showSynced) return false;
      if (isPaperless && !showPaperless) return false;
      if (isGoodreads && !showGoodreads) return false;
      if (isCustomOcr && !showCustomOcr) return false;
      if (isCalendar && !showCalendar) return false;

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
          file.goodreadsTitle?.toLowerCase().includes(query) ||
          file.eventTitle?.toLowerCase().includes(query);
        const matchesAuthor = file.goodreadsAuthor
          ?.toLowerCase()
          .includes(query);
        const matchesTags = file.paperlessTags?.toLowerCase().includes(query);
        const matchesCorrespondent = file.paperlessCorrespondent
          ?.toLowerCase()
          .includes(query);
        const matchesUser = file.userName?.toLowerCase().includes(query);
        const matchesLocation = file.eventLocation?.toLowerCase().includes(query);
        const matchesCalendar = file.calendarName?.toLowerCase().includes(query);

        if (
          !matchesPath &&
          !matchesTitle &&
          !matchesAuthor &&
          !matchesTags &&
          !matchesCorrespondent &&
          !matchesUser &&
          !matchesLocation &&
          !matchesCalendar
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
            if (file.eventTitle) return file.eventTitle.toLowerCase();
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

  // Virtual scrolling setup
  const rowVirtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => tableParentRef.current,
    estimateSize: () => 60, // Estimated row height in pixels
    overscan: 10, // Render 10 extra rows above/below viewport
  });

  // Helper function to check if a file matches the search query
  const matchesSearch = (file: IndexedFile) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const matchesPath = file.filePath.toLowerCase().includes(query);
    const matchesTitle =
      file.paperlessTitle?.toLowerCase().includes(query) ||
      file.goodreadsTitle?.toLowerCase().includes(query) ||
      file.eventTitle?.toLowerCase().includes(query);
    const matchesAuthor = file.goodreadsAuthor?.toLowerCase().includes(query);
    const matchesTags = file.paperlessTags?.toLowerCase().includes(query);
    const matchesCorrespondent = file.paperlessCorrespondent
      ?.toLowerCase()
      .includes(query);
    const matchesUser = file.userName?.toLowerCase().includes(query);
    const matchesLocation = file.eventLocation?.toLowerCase().includes(query);
    const matchesCalendar = file.calendarName?.toLowerCase().includes(query);

    return (
      matchesPath ||
      matchesTitle ||
      matchesAuthor ||
      matchesTags ||
      matchesCorrespondent ||
      matchesUser ||
      matchesLocation ||
      matchesCalendar
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
  const calendarCount = files.filter(
    (f) => f.source === "google-calendar" && matchesSearch(f),
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
        showCalendar={showCalendar}
        uploadedCount={uploadedCount}
        syncedCount={syncedCount}
        paperlessCount={paperlessCount}
        goodreadsCount={goodreadsCount}
        customOcrCount={customOcrCount}
        calendarCount={calendarCount}
        filteredCount={filteredFiles.length}
        totalCount={files.length}
        onToggleUploaded={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr && showCalendar;
          if (allSelected) {
            // If all are selected, select only this one
            setShowUploaded(true);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(false);
            setShowCalendar(false);
          } else {
            // Check if this is the last one selected
            const isLastSelected = showUploaded && !showSynced && !showPaperless && !showGoodreads && !showCustomOcr && !showCalendar;
            if (isLastSelected) {
              // Select all instead of deselecting the last one
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
            } else {
              // Otherwise, toggle this one
              setShowUploaded(!showUploaded);
            }
          }
        }}
        onToggleSynced={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr && showCalendar;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(true);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(false);
            setShowCalendar(false);
          } else {
            const isLastSelected = !showUploaded && showSynced && !showPaperless && !showGoodreads && !showCustomOcr && !showCalendar;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
            } else {
              setShowSynced(!showSynced);
            }
          }
        }}
        onTogglePaperless={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr && showCalendar;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(false);
            setShowPaperless(true);
            setShowGoodreads(false);
            setShowCustomOcr(false);
            setShowCalendar(false);
          } else {
            const isLastSelected = !showUploaded && !showSynced && showPaperless && !showGoodreads && !showCustomOcr && !showCalendar;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
            } else {
              setShowPaperless(!showPaperless);
            }
          }
        }}
        onToggleGoodreads={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr && showCalendar;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(true);
            setShowCustomOcr(false);
            setShowCalendar(false);
          } else {
            const isLastSelected = !showUploaded && !showSynced && !showPaperless && showGoodreads && !showCustomOcr && !showCalendar;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
            } else {
              setShowGoodreads(!showGoodreads);
            }
          }
        }}
        onToggleCustomOcr={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr && showCalendar;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(true);
            setShowCalendar(false);
          } else {
            const isLastSelected = !showUploaded && !showSynced && !showPaperless && !showGoodreads && showCustomOcr && !showCalendar;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
            } else {
              setShowCustomOcr(!showCustomOcr);
            }
          }
        }}
        onToggleCalendar={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr && showCalendar;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(false);
            setShowCalendar(true);
          } else {
            const isLastSelected = !showUploaded && !showSynced && !showPaperless && !showGoodreads && !showCustomOcr && showCalendar;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
            } else {
              setShowCalendar(!showCalendar);
            }
          }
        }}
      />

      <div
        ref={tableParentRef}
        className={styles.tableWrapper}
        style={{
          height: '600px',
          overflow: 'auto',
        }}
      >
        <table className={styles.table}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--background)', zIndex: 1 }}>
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
                  Loading first batch...
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
              rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const file = filteredFiles[virtualRow.index];
                return (
                  <FileTableRow
                    key={virtualRow.key}
                    file={file}
                    isScanning={isScanning}
                    onReindex={handleReindex}
                    onDelete={handleDelete}
                    onUseCustomOcr={handleUseCustomOcr}
                  />
                );
              })
            )}
          </tbody>
        </table>
        {isLoadingMore && (
          <div className={styles.loadingMore}>
            <i className="fas fa-spinner fa-spin"></i> Loading more files in background...
          </div>
        )}
      </div>
    </div>
  );
}
