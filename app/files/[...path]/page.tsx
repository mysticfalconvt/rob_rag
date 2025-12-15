"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import FileViewerHeader from "@/components/FileViewerHeader";
import FileMetadata from "@/components/FileMetadata";
import DocumentTags from "@/components/DocumentTags";
import { useFileHighlight } from "@/hooks/useFileHighlight";
import styles from "./page.module.css";

interface Tag {
  id: string;
  name: string;
  status: string;
  color?: string;
}

interface FileData {
  fileId: string;
  fileName: string;
  filePath: string;
  fileType: string;
  content: string;
  source?: string;
  paperlessId?: number;
  paperlessUrl?: string;
  paperlessTags?: string[];
  paperlessCorrespondent?: string;
  goodreadsBookId?: string;
  tags?: Tag[];
  metadata: {
    size?: number;
    lastModified?: string;
    chunkCount: number;
    lastIndexed: string;
    author?: string;
    rating?: number | null;
    dateRead?: string | null;
    dateAdded?: string | null;
    shelves?: string[];
    userName?: string;
    extractedDate?: string;
    extractedTags?: string[];
    documentType?: string;
    documentSummary?: string;
    originalDocPath?: string;
  };
}

function FileViewerPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const contentRef = useRef<HTMLDivElement>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReverting, setIsReverting] = useState(false);

  const chunkText = searchParams.get("chunk");
  const highlightedContent = useFileHighlight(
    fileData?.content || "",
    fileData?.fileType || "",
    chunkText,
  );

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

  // Replace markers with actual mark tags after rendering (for markdown)
  useEffect(() => {
    if (!chunkText || !contentRef.current || !fileData) return;

    const isMarkdown =
      fileData.fileType === "md" || fileData.fileType === "markdown";

    if (isMarkdown) {
      const timer = setTimeout(() => {
        const contentElement = contentRef.current;
        if (!contentElement) return;

        const innerHTML = contentElement.innerHTML;

        if (
          innerHTML.includes("⟪HIGHLIGHT_START⟫") &&
          innerHTML.includes("⟪HIGHLIGHT_END⟫")
        ) {
          const newHTML = innerHTML
            .replace("⟪HIGHLIGHT_START⟫", '<mark id="highlighted-chunk">')
            .replace("⟪HIGHLIGHT_END⟫", "</mark>");

          contentElement.innerHTML = newHTML;

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
  }, [fileData, chunkText]);

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

  const handleRevertOcr = async () => {
    if (!fileData?.paperlessId) return;

    if (
      !confirm(
        "Are you sure you want to revert to Paperless OCR?\n\n" +
          "This will:\n" +
          "- Delete the custom OCR output\n" +
          "- Delete the original PDF copy\n" +
          "- Re-index with Paperless OCR content\n\n" +
          "This action cannot be undone.",
      )
    ) {
      return;
    }

    setIsReverting(true);
    try {
      const res = await fetch("/api/ocr/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperlessId: fileData.paperlessId }),
      });

      if (res.ok) {
        alert("✅ Successfully reverted to Paperless OCR");
        // Redirect back to files page
        window.location.href = "/files";
      } else {
        const error = await res.json();
        alert(`❌ Failed to revert: ${error.details || error.error}`);
      }
    } catch (error) {
      console.error("Error reverting OCR:", error);
      alert("❌ Failed to revert OCR");
    } finally {
      setIsReverting(false);
    }
  };

  const isMarkdown =
    fileData.fileType === "md" ||
    fileData.fileType === "markdown" ||
    fileData.fileType === "goodreads";

  return (
    <div className={styles.container}>
      <FileViewerHeader
        fileName={fileData.fileName}
        source={fileData.source || ""}
        paperlessUrl={fileData.paperlessUrl}
        originalDocPath={fileData.metadata.originalDocPath}
        paperlessId={fileData.paperlessId}
        onRevertOcr={isReverting ? undefined : handleRevertOcr}
      />

      <FileMetadata
        source={fileData.source || ""}
        fileType={fileData.fileType}
        metadata={fileData.metadata}
        paperlessTags={fileData.paperlessTags}
        paperlessCorrespondent={fileData.paperlessCorrespondent}
      />

      {fileData.fileId && (
        <DocumentTags
          fileId={fileData.fileId}
          initialTags={fileData.tags || []}
        />
      )}

      <div className={styles.content} ref={contentRef}>
        {isMarkdown ? (
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
