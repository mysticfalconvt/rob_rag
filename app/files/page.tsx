"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

// Fetch all files in large pages. The server caps `limit` at 500, so use that
// to minimize the number of round-trips, and don't sleep between pages.
async function fetchAllFiles(): Promise<IndexedFile[]> {
  const allFiles: IndexedFile[] = [];
  let offset = 0;
  const chunkSize = 500;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`/api/files?offset=${offset}&limit=${chunkSize}`);
    if (!res.ok) break;
    const chunk = await res.json();
    if (chunk.length > 0) {
      allFiles.push(...chunk);
      offset += chunk.length;
      hasMore = chunk.length === chunkSize;
    } else {
      hasMore = false;
    }
  }

  return allFiles;
}

export default function FilesPage() {
  const queryClient = useQueryClient();
  const [isScanning, setIsScanning] = useState(false);

  const [showUploaded, setShowUploaded] = useState(true);
  const [showSynced, setShowSynced] = useState(true);
  const [showPaperless, setShowPaperless] = useState(true);
  const [showGoodreads, setShowGoodreads] = useState(true);
  const [showCustomOcr, setShowCustomOcr] = useState(true);
  const [showCalendar, setShowCalendar] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [taggedFilter, setTaggedFilter] = useState<"all" | "tagged" | "untagged">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<
    "source" | "fileName" | "chunkCount" | "status" | "lastIndexed"
  >("lastIndexed");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const tableParentRef = useRef<HTMLDivElement>(null);

  // Use TanStack Query for data fetching and caching. Inherit the global
  // defaults from providers.tsx (staleTime 5m, refetchOnMount false, IndexedDB
  // persistence) so navigating back to this page shows the cached list
  // instantly instead of re-running the full fetch every time.
  const { data: files = [], isLoading, isRefetching } = useQuery({
    queryKey: ['files'],
    queryFn: fetchAllFiles,
  });

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

  // Restore scroll position after data loads
  useEffect(() => {
    if (!isLoading && files.length > 0) {
      const savedScroll = sessionStorage.getItem('files-scroll');
      if (savedScroll && tableParentRef.current) {
        setTimeout(() => {
          if (tableParentRef.current) {
            tableParentRef.current.scrollTop = parseInt(savedScroll);
          }
        }, 50);
      }
    }
  }, [isLoading, files.length]);


  const handleSort = useCallback((
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
  }, [sortColumn, sortDirection]);

  const handleReindex = useCallback(async (filePath: string) => {
    setIsScanning(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      if (res.ok) {
        // Invalidate query cache to refetch
        await queryClient.invalidateQueries({ queryKey: ['files'] });
      }
    } catch (error) {
      console.error("Error re-indexing file:", error);
    } finally {
      setIsScanning(false);
    }
  }, [queryClient]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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
        // Invalidate query cache to refetch
        await queryClient.invalidateQueries({ queryKey: ['files'] });
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
  }, [queryClient]);

  const handleDelete = useCallback(async (filePath: string) => {
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
        // Invalidate query cache to refetch
        await queryClient.invalidateQueries({ queryKey: ['files'] });
      }
    } catch (error) {
      console.error("Error deleting file:", error);
    }
  }, [queryClient]);

  const handleUseCustomOcr = useCallback(async (paperlessId: number) => {
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
        // Invalidate query cache to refetch and show processing status
        await queryClient.invalidateQueries({ queryKey: ['files'] });
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
  }, [queryClient]);

  // Filter + sort the full list. This is O(n log n) over every file, so it must
  // only run when the inputs actually change — not on every render (e.g. every
  // keystroke re-rendering the page).
  const filteredFiles = useMemo(() => {
    return files
      .filter((file) => {
        const isUploaded = file.source === "uploaded";
        const isSynced =
          file.source === "synced" || file.source === "local" || !file.source;
        const isPaperless = file.source === "paperless";
        const isGoodreads = file.source === "goodreads";
        const isCustomOcr = file.source === "custom_ocr";
        const isCalendar = file.source === "google-calendar";
        const isNote = file.source === "user_note";

        if (isUploaded && !showUploaded) return false;
        if (isSynced && !showSynced) return false;
        if (isPaperless && !showPaperless) return false;
        if (isGoodreads && !showGoodreads) return false;
        if (isCustomOcr && !showCustomOcr) return false;
        if (isCalendar && !showCalendar) return false;
        if (isNote && !showNotes) return false;

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
          case "fileName": {
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
          }
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
  }, [
    files,
    showUploaded,
    showSynced,
    showPaperless,
    showGoodreads,
    showCustomOcr,
    showCalendar,
    showNotes,
    selectedTags,
    taggedFilter,
    searchQuery,
    sortColumn,
    sortDirection,
  ]);

  // Calculate per-source counts based on the current search. Recomputing these
  // 7 full passes on every render is wasteful, so memoize on (files, search).
  const counts = useMemo(() => {
    const matchesSearch = (file: IndexedFile) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        file.filePath.toLowerCase().includes(query) ||
        !!file.paperlessTitle?.toLowerCase().includes(query) ||
        !!file.goodreadsTitle?.toLowerCase().includes(query) ||
        !!file.eventTitle?.toLowerCase().includes(query) ||
        !!file.goodreadsAuthor?.toLowerCase().includes(query) ||
        !!file.paperlessTags?.toLowerCase().includes(query) ||
        !!file.paperlessCorrespondent?.toLowerCase().includes(query) ||
        !!file.userName?.toLowerCase().includes(query) ||
        !!file.eventLocation?.toLowerCase().includes(query) ||
        !!file.calendarName?.toLowerCase().includes(query)
      );
    };

    const c = {
      uploaded: 0,
      synced: 0,
      paperless: 0,
      goodreads: 0,
      customOcr: 0,
      calendar: 0,
      notes: 0,
    };

    for (const f of files) {
      if (!matchesSearch(f)) continue;
      switch (f.source) {
        case "uploaded":
          c.uploaded++;
          break;
        case "paperless":
          c.paperless++;
          break;
        case "goodreads":
          c.goodreads++;
          break;
        case "custom_ocr":
          c.customOcr++;
          break;
        case "google-calendar":
          c.calendar++;
          break;
        case "user_note":
          c.notes++;
          break;
        case "synced":
        case "local":
        default:
          // synced/local/empty source all count as "synced"
          if (
            f.source === "synced" ||
            f.source === "local" ||
            !f.source
          ) {
            c.synced++;
          }
          break;
      }
    }

    return c;
  }, [files, searchQuery]);

  // Virtualize the table body so only the rows near the viewport are mounted.
  // Row heights vary (tags, authors, event details), so measure them
  // dynamically with an estimate to seed the initial layout.
  const rowVirtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => tableParentRef.current,
    estimateSize: () => 73,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div className={styles.container}>
      <FilesHeader
        isScanning={isScanning}
        onUpload={handleUpload}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <BulkTagGeneration onComplete={() => queryClient.invalidateQueries({ queryKey: ['files'] })} />

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
        showNotes={showNotes}
        uploadedCount={counts.uploaded}
        syncedCount={counts.synced}
        paperlessCount={counts.paperless}
        goodreadsCount={counts.goodreads}
        customOcrCount={counts.customOcr}
        calendarCount={counts.calendar}
        notesCount={counts.notes}
        filteredCount={filteredFiles.length}
        totalCount={files.length}
        onToggleUploaded={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr && showCalendar && showNotes;
          if (allSelected) {
            // If all are selected, select only this one
            setShowUploaded(true);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(false);
            setShowCalendar(false);
            setShowNotes(false);
          } else {
            // Check if this is the last one selected
            const isLastSelected = showUploaded && !showSynced && !showPaperless && !showGoodreads && !showCustomOcr && !showCalendar && !showNotes;
            if (isLastSelected) {
              // Select all instead of deselecting the last one
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
              setShowNotes(true);
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
            setShowNotes(false);
          } else {
            const isLastSelected = !showUploaded && showSynced && !showPaperless && !showGoodreads && !showCustomOcr && !showCalendar && !showNotes;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
              setShowNotes(true);
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
            setShowNotes(false);
          } else {
            const isLastSelected = !showUploaded && !showSynced && showPaperless && !showGoodreads && !showCustomOcr && !showCalendar && !showNotes;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
              setShowNotes(true);
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
            setShowNotes(false);
          } else {
            const isLastSelected = !showUploaded && !showSynced && !showPaperless && showGoodreads && !showCustomOcr && !showCalendar && !showNotes;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
              setShowNotes(true);
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
            setShowNotes(false);
          } else {
            const isLastSelected = !showUploaded && !showSynced && !showPaperless && !showGoodreads && showCustomOcr && !showCalendar && !showNotes;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
              setShowNotes(true);
            } else {
              setShowCustomOcr(!showCustomOcr);
            }
          }
        }}
        onToggleCalendar={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr && showCalendar && showNotes;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(false);
            setShowCalendar(true);
            setShowNotes(false);
          } else {
            const isLastSelected = !showUploaded && !showSynced && !showPaperless && !showGoodreads && !showCustomOcr && showCalendar && !showNotes;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
              setShowNotes(true);
            } else {
              setShowCalendar(!showCalendar);
            }
          }
        }}
        onToggleNotes={() => {
          const allSelected = showUploaded && showSynced && showPaperless && showGoodreads && showCustomOcr && showCalendar && showNotes;
          if (allSelected) {
            setShowUploaded(false);
            setShowSynced(false);
            setShowPaperless(false);
            setShowGoodreads(false);
            setShowCustomOcr(false);
            setShowCalendar(false);
            setShowNotes(true);
          } else {
            const isLastSelected = !showUploaded && !showSynced && !showPaperless && !showGoodreads && !showCustomOcr && !showCalendar && showNotes;
            if (isLastSelected) {
              setShowUploaded(true);
              setShowSynced(true);
              setShowPaperless(true);
              setShowGoodreads(true);
              setShowCustomOcr(true);
              setShowCalendar(true);
              setShowNotes(true);
            } else {
              setShowNotes(!showNotes);
            }
          }
        }}
      />

      <div ref={tableParentRef} className={styles.tableWrapper}>
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
                  Loading files...
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
              <>
                {paddingTop > 0 && (
                  <tr aria-hidden>
                    <td
                      colSpan={6}
                      style={{ height: paddingTop, padding: 0, border: "none" }}
                    />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const file = filteredFiles[virtualRow.index];
                  return (
                    <FileTableRow
                      key={file.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      file={file}
                      isScanning={isScanning}
                      onReindex={handleReindex}
                      onDelete={handleDelete}
                      onUseCustomOcr={handleUseCustomOcr}
                    />
                  );
                })}
                {paddingBottom > 0 && (
                  <tr aria-hidden>
                    <td
                      colSpan={6}
                      style={{ height: paddingBottom, padding: 0, border: "none" }}
                    />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
        {isRefetching && !isLoading && (
          <div className={styles.loadingMore}>
            <i className="fas fa-spinner fa-spin"></i> Updating files in background...
          </div>
        )}
      </div>
    </div>
  );
}
