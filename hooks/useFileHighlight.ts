"use client";

import { useEffect, useState } from "react";

export function useFileHighlight(
  content: string,
  fileType: string,
  chunkText: string | null
) {
  const [highlightedContent, setHighlightedContent] = useState<string>("");

  useEffect(() => {
    if (!content || !chunkText) {
      setHighlightedContent("");
      return;
    }

    const isMarkdown = fileType === "md" || fileType === "markdown";
    const chunkIndex = content.indexOf(chunkText);

    if (chunkIndex === -1) {
      setHighlightedContent(isMarkdown ? "" : content);
      return;
    }

    const before = content.substring(0, chunkIndex);
    const chunk = content.substring(chunkIndex, chunkIndex + chunkText.length);
    const after = content.substring(chunkIndex + chunkText.length);

    if (isMarkdown) {
      // Use unique markers for markdown
      const markedContent = `${before}⟪HIGHLIGHT_START⟫${chunk}⟪HIGHLIGHT_END⟫${after}`;
      setHighlightedContent(markedContent);
    } else {
      // For plain text, inject HTML directly
      const htmlContent = `${before}<mark id="highlighted-chunk">${chunk}</mark>${after}`;
      setHighlightedContent(htmlContent);
    }
  }, [content, fileType, chunkText]);

  return highlightedContent;
}
