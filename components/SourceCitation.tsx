'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './SourceCitation.module.css';

interface Source {
    fileName: string;
    filePath: string;
    chunk: string;
    score: number;
}

interface SourceCitationProps {
    sources: Source[];
}

export default function SourceCitation({ sources }: SourceCitationProps) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    if (!sources || sources.length === 0) return null;

    return (
        <div className={styles.container}>
            <div className={styles.label}>Sources:</div>
            <div className={styles.sources}>
                {sources.map((source, index) => {
                    const encodedPath = encodeURIComponent(source.filePath);

                    return (
                        <div
                            key={index}
                            className={styles.sourceWrapper}
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                        >
                            <Link
                                href={`/files${source.filePath}?chunk=${encodeURIComponent(source.chunk)}`}
                                className={styles.sourceLink}
                            >
                                <i className="fas fa-file-alt"></i>
                                {source.fileName}
                                <span className={styles.score}>
                                    {(source.score * 100).toFixed(0)}%
                                </span>
                            </Link>

                            {hoveredIndex === index && (
                                <div className={styles.tooltip}>
                                    <div className={styles.tooltipHeader}>
                                        Relevant Chunk (Score: {(source.score * 100).toFixed(1)}%)
                                    </div>
                                    <div className={styles.tooltipContent}>
                                        {source.chunk.length > 300
                                            ? source.chunk.substring(0, 300) + '...'
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
