"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./page.module.css";

interface FileData {
  fileName: string;
  filePath: string;
  fileType: string;
  content: string;
  source?: string;
  paperlessId?: number;
  paperlessUrl?: string;
  paperlessTags?: string[];
  paperlessCorrespondent?: string;
  metadata: {
    size: number;
    lastModified: string;
    chunkCount: number;
    lastIndexed: string;
  };
}

function FileViewerPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const contentRef = useRef<HTMLDivElement>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedContent, setHighlightedContent] = useState<string>("");

  useEffect(() => {
    const fetchFile = async () => {
      try {
        const pathArray = Array.isArray(params.path)
          ? params.path
          : [params.path];
        const response = await fetch(`/api/files/${pathArray.join("/")}`);

        if (!response.ok) {
          throw new Error("Failed to fetch file");
        }

        const data = await response.json();
        setFileData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchFile();
  }, [params.path]);

  // Prepare content with markers for highlighting
  useEffect(() => {
    if (!fileData) return;

    const chunkText = searchParams.get("chunk");
    if (!chunkText) {
      setHighlightedContent("");
      return;
    }

    // For plain text files, inject HTML directly
    if (fileData.fileType !== "md" && fileData.fileType !== "markdown") {
      const content = fileData.content;
      const chunkIndex = content.indexOf(chunkText);

      if (chunkIndex !== -1) {
        const before = content.substring(0, chunkIndex);
        const chunk = content.substring(
          chunkIndex,
          chunkIndex + chunkText.length,
        );
        const after = content.substring(chunkIndex + chunkText.length);

        setHighlightedContent(
          `${before}<mark id="highlighted-chunk">${chunk}</mark>${after}`,
        );
      } else {
        setHighlightedContent(fileData.content);
      }
    } else {
      // For markdown, inject unique markers that will survive markdown rendering
      const content = fileData.content;
      const chunkIndex = content.indexOf(chunkText);

      if (chunkIndex !== -1) {
        const before = content.substring(0, chunkIndex);
        const chunk = content.substring(
          chunkIndex,
          chunkIndex + chunkText.length,
        );
        const after = content.substring(chunkIndex + chunkText.length);

        // Use unique markers that ReactMarkdown will render as text
        const markedContent = `${before}⟪HIGHLIGHT_START⟫${chunk}⟪HIGHLIGHT_END⟫${after}`;
        setHighlightedContent(markedContent);
      } else {
        setHighlightedContent("");
      }
    }
  }, [fileData, searchParams]);

  // Replace markers with actual mark tags after rendering
  useEffect(() => {
    const chunkText = searchParams.get("chunk");
    if (!chunkText || !contentRef.current || !fileData) return;

    if (fileData.fileType === "md" || fileData.fileType === "markdown") {
      // Wait for ReactMarkdown to render
      const timer = setTimeout(() => {
        const contentElement = contentRef.current;
        if (!contentElement) return;

        // Find and replace the markers with actual mark tags
        const innerHTML = contentElement.innerHTML;

        if (
          innerHTML.includes("⟪HIGHLIGHT_START⟫") &&
          innerHTML.includes("⟪HIGHLIGHT_END⟫")
        ) {
          const newHTML = innerHTML
            .replace("⟪HIGHLIGHT_START⟫", '<mark id="highlighted-chunk">')
            .replace("⟪HIGHLIGHT_END⟫", "</mark>");

          contentElement.innerHTML = newHTML;

          // Scroll to highlight
          setTimeout(() => {
            const mark = document.getElementById("highlighted-chunk");
            if (mark) {
              mark.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, 100);
        }
      }, 300);

      return () => clearTimeout(timer);
    } else {
      // For plain text, scroll to the mark tag
      const timer = setTimeout(() => {
        const highlightedElement = document.getElementById("highlighted-chunk");
        if (highlightedElement) {
          highlightedElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [fileData, searchParams]);

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
          <p>{error || "File not found"}</p>
        </div>
      </div>
    );
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const isPaperless = fileData.source === "paperless";
  const isUploaded = fileData.source === "uploaded";
  const _isSynced =
    fileData.source === "synced" ||
    fileData.source === "local" ||
    !fileData.source;
  console.log(fileData);
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <i
            className={`fas ${isPaperless ? "fa-file-archive" : isUploaded ? "fa-upload" : "fa-sync"} ${styles.icon}`}
          ></i>
          <h1>{fileData.fileName}</h1>
          <span
            className={`${styles.sourceBadge} ${
              isPaperless
                ? styles.paperless
                : isUploaded
                  ? styles.uploaded
                  : styles.synced
            }`}
          >
            {isPaperless ? (
              <>
                <i className="fas fa-file-archive"></i> Paperless-ngx
              </>
            ) : isUploaded ? (
              <>
                <i className="fas fa-upload"></i> Uploaded File
              </>
            ) : (
              <>
                <i className="fas fa-sync"></i> Synced File
              </>
            )}
          </span>
        </div>

        {isPaperless && fileData.paperlessUrl && (
          <div className={styles.paperlessLink}>
            <a
              href={fileData.paperlessUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.viewInPaperless}
            >
              <i className="fas fa-external-link-alt"></i> View in Paperless-ngx
            </a>
          </div>
        )}

        <div className={styles.metadata}>
          {isPaperless &&
            fileData.paperlessTags &&
            fileData.paperlessTags.length > 0 && (
              <div className={styles.metadataItem}>
                <span className={styles.metadataLabel}>Tags:</span>
                <span className={styles.metadataValue}>
                  {fileData.paperlessTags.map((tag, idx) => (
                    <span key={idx} className={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </span>
              </div>
            )}
          {isPaperless && fileData.paperlessCorrespondent && (
            <div className={styles.metadataItem}>
              <span className={styles.metadataLabel}>Correspondent:</span>
              <span className={styles.metadataValue}>
                {fileData.paperlessCorrespondent}
              </span>
            </div>
          )}
          <div className={styles.metadataItem}>
            <span className={styles.metadataLabel}>Type:</span>
            <span className={styles.metadataValue}>
              {isPaperless
                ? "Paperless Document"
                : fileData.fileType.toUpperCase()}
            </span>
          </div>
          <div className={styles.metadataItem}>
            <span className={styles.metadataLabel}>Size:</span>
            <span className={styles.metadataValue}>
              {formatFileSize(fileData.metadata.size)}
            </span>
          </div>
          <div className={styles.metadataItem}>
            <span className={styles.metadataLabel}>Chunks:</span>
            <span className={styles.metadataValue}>
              {fileData.metadata.chunkCount}
            </span>
          </div>
          <div className={styles.metadataItem}>
            <span className={styles.metadataLabel}>Last Modified:</span>
            <span className={styles.metadataValue}>
              {formatDate(fileData.metadata.lastModified)}
            </span>
          </div>
          <div className={styles.metadataItem}>
            <span className={styles.metadataLabel}>Last Indexed:</span>
            <span className={styles.metadataValue}>
              {formatDate(fileData.metadata.lastIndexed)}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.content} ref={contentRef}>
        {fileData.fileType === "md" || fileData.fileType === "markdown" ? (
          <div className={styles.markdown}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {highlightedContent || fileData.content}
            </ReactMarkdown>
          </div>
        ) : (
          <pre
            className={styles.plainText}
            dangerouslySetInnerHTML={{
              __html: highlightedContent || fileData.content,
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function FileViewerPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.container}>
          <div className={styles.loading}>
            <i className="fas fa-spinner fa-spin fa-2x"></i>
            <p>Loading...</p>
          </div>
        </div>
      }
    >
      <FileViewerPageContent />
    </Suspense>
  );
}
