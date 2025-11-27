"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./SourceCitation.module.css";
import type { Source } from "@/types/source";

interface SourceCitationProps {
  sources: Source[];
}

export default function SourceCitation({ sources }: SourceCitationProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [showAllSources, setShowAllSources] = useState(false);

  if (!sources || sources.length === 0) return null;

  // Separate referenced and non-referenced sources
  const referencedSources = sources.filter((s) => s.isReferenced);
  const nonReferencedSources = sources.filter((s) => !s.isReferenced);

  // Determine which sources to display
  const displaySources = showAllSources ? sources : referencedSources;

  // If no sources have relevance analysis, show all sources by default
  const hasRelevanceData = sources.some(
    (s) => s.relevanceScore !== undefined && s.isReferenced !== undefined,
  );
  const sourcesToShow = hasRelevanceData ? displaySources : sources;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.label}>
          Sources:
          {hasRelevanceData && referencedSources.length > 0 && (
            <span className={styles.count}>
              {showAllSources
                ? `${referencedSources.length} referenced, ${nonReferencedSources.length} additional`
                : `${referencedSources.length} referenced`}
            </span>
          )}
        </div>
        {hasRelevanceData &&
          referencedSources.length > 0 &&
          nonReferencedSources.length > 0 && (
            <button
              className={styles.toggleButton}
              onClick={() => setShowAllSources(!showAllSources)}
            >
              {showAllSources
                ? "Show Referenced Only"
                : `Show All (${sources.length})`}
            </button>
          )}
      </div>
      <div className={styles.sources}>
        {sourcesToShow.map((source, index) => {
          const _encodedPath = encodeURIComponent(source.filePath);

          return (
            <div
              key={index}
              className={styles.sourceWrapper}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <Link
                href={`/files/${encodeURIComponent(source.filePath)}?chunk=${encodeURIComponent(source.chunk)}`}
                className={styles.sourceLink}
              >
                <span className={styles.icon}>
                  {source.source === "paperless"
                    ? "🗂️"
                    : source.source === "uploaded"
                      ? "📤"
                      : source.source === "goodreads"
                        ? "📚"
                        : "🔄"}
                </span>
                <span className={styles.fileName}>{source.fileName}</span>
                <span className={styles.score}>
                  {(source.score * 100).toFixed(0)}%
                </span>
              </Link>

              {hoveredIndex === index && (
                <div className={styles.tooltip}>
                  <div className={styles.tooltipHeader}>
                    <span className={styles.tooltipFileName}>
                      {source.fileName}
                    </span>
                    <span className={styles.tooltipScore}>
                      Score: {(source.score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className={styles.tooltipContent}>
                    {source.chunk.length > 300
                      ? `${source.chunk.substring(0, 300)}...`
                      : source.chunk}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
