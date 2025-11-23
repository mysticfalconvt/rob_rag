"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import FileViewerHeader from "@/components/FileViewerHeader";
import FileMetadata from "@/components/FileMetadata";
import { useFileHighlight } from "@/hooks/useFileHighlight";
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
  goodreadsBookId?: string;
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
  };
}

function FileViewerPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const contentRef = useRef<HTMLDivElement>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      />

      <FileMetadata
        source={fileData.source || ""}
        fileType={fileData.fileType}
        metadata={fileData.metadata}
        paperlessTags={fileData.paperlessTags}
        paperlessCorrespondent={fileData.paperlessCorrespondent}
      />

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
