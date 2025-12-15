"use client";

import { useEffect, useState } from "react";
import styles from "./DocumentTags.module.css";

interface Tag {
  id: string;
  name: string;
  status: string;
  color?: string;
}

interface GeneratedTag extends Tag {
  isNew?: boolean;
}

interface DocumentTagsProps {
  fileId: string;
  initialTags: Tag[];
  onTagsChange?: (tags: Tag[]) => void;
}

export default function DocumentTags({
  fileId,
  initialTags,
  onTagsChange,
}: DocumentTagsProps) {
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTags, setGeneratedTags] = useState<GeneratedTag[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchAllTags();
  }, []);

  const fetchAllTags = async () => {
    try {
      const res = await fetch("/api/tags");
      if (res.ok) {
        const data = await res.json();
        setAllTags(data);
      }
    } catch (error) {
      console.error("Error fetching tags:", error);
    }
  };

  const handleGenerateTags = async () => {
    setIsGenerating(true);
    setGeneratedTags([]);
    try {
      const res = await fetch(`/api/documents/${fileId}/generate-tags`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedTags(data.tags);
      } else {
        const error = await res.json();
        alert(`Failed to generate tags: ${error.error}`);
      }
    } catch (error) {
      console.error("Error generating tags:", error);
      alert("Failed to generate tags");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddTag = async (tagId: string) => {
    try {
      const res = await fetch(`/api/documents/${fileId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
      });

      if (res.ok) {
        const newTag = await res.json();
        const updatedTags = [...tags, newTag];
        setTags(updatedTags);
        onTagsChange?.(updatedTags);
        // Remove from generated tags if present
        setGeneratedTags((prev) => prev.filter((t) => t.id !== tagId));
      } else if (res.status === 409) {
        // Tag already exists on document
        setGeneratedTags((prev) => prev.filter((t) => t.id !== tagId));
      } else {
        const error = await res.json();
        alert(`Failed to add tag: ${error.error}`);
      }
    } catch (error) {
      console.error("Error adding tag:", error);
      alert("Failed to add tag");
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      const res = await fetch(`/api/documents/${fileId}/tags?tagId=${tagId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const updatedTags = tags.filter((t) => t.id !== tagId);
        setTags(updatedTags);
        onTagsChange?.(updatedTags);
      } else {
        const error = await res.json();
        alert(`Failed to remove tag: ${error.error}`);
      }
    } catch (error) {
      console.error("Error removing tag:", error);
      alert("Failed to remove tag");
    }
  };

  const handleDismissGenerated = (tagId: string) => {
    setGeneratedTags((prev) => prev.filter((t) => t.id !== tagId));
  };

  const filteredAvailableTags = allTags
    .filter((tag) => !tags.some((t) => t.id === tag.id))
    .filter((tag) =>
      tag.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>Tags</h3>
        <button
          onClick={handleGenerateTags}
          disabled={isGenerating}
          className={styles.generateButton}
          title="Generate tags using AI"
        >
          {isGenerating ? (
            <>
              <i className="fas fa-spinner fa-spin"></i> Generating...
            </>
          ) : (
            <>
              <i className="fas fa-magic"></i> Generate Tags
            </>
          )}
        </button>
      </div>

      {/* Current Tags */}
      {tags.length > 0 && (
        <div className={styles.tagSection}>
          <div className={styles.tagList}>
            {tags.map((tag) => (
              <div
                key={tag.id}
                className={`${styles.tag} ${tag.status === "pending" ? styles.pendingTag : ""}`}
              >
                <span className={styles.tagName}>{tag.name}</span>
                {tag.status === "pending" && (
                  <span className={styles.pendingBadge}>Pending</span>
                )}
                <button
                  onClick={() => handleRemoveTag(tag.id)}
                  className={styles.removeButton}
                  title="Remove tag"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generated Tag Suggestions */}
      {generatedTags.length > 0 && (
        <div className={styles.suggestionsSection}>
          <div className={styles.suggestionsHeader}>
            <span>Suggested Tags</span>
            <span className={styles.suggestionsHint}>
              Click to add, or dismiss suggestions
            </span>
          </div>
          <div className={styles.tagList}>
            {generatedTags.map((tag) => (
              <div
                key={tag.id}
                className={`${styles.tag} ${styles.suggestedTag} ${tag.isNew ? styles.newTag : styles.existingTag}`}
              >
                <span className={styles.tagName}>
                  {tag.name}
                  {tag.isNew && (
                    <span className={styles.newBadge} title="New tag">
                      NEW
                    </span>
                  )}
                  {tag.status === "pending" && (
                    <span className={styles.pendingBadge}>Pending</span>
                  )}
                </span>
                <div className={styles.suggestedActions}>
                  <button
                    onClick={() => handleAddTag(tag.id)}
                    className={styles.addButton}
                    title="Add this tag"
                  >
                    <i className="fas fa-plus"></i>
                  </button>
                  <button
                    onClick={() => handleDismissGenerated(tag.id)}
                    className={styles.dismissButton}
                    title="Dismiss suggestion"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Tag Manually */}
      <div className={styles.addSection}>
        <button
          onClick={() => setShowTagPicker(!showTagPicker)}
          className={styles.addTagButton}
        >
          <i className="fas fa-plus"></i> Add Tag
        </button>

        {showTagPicker && (
          <div className={styles.tagPicker}>
            <input
              type="text"
              placeholder="Search tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
              autoFocus
            />
            <div className={styles.availableTags}>
              {filteredAvailableTags.length > 0 ? (
                filteredAvailableTags.map((tag) => (
                  <div
                    key={tag.id}
                    onClick={() => {
                      handleAddTag(tag.id);
                      setSearchQuery("");
                    }}
                    className={`${styles.availableTag} ${tag.status === "pending" ? styles.pendingTag : ""}`}
                  >
                    <span>{tag.name}</span>
                    {tag.status === "pending" && (
                      <span className={styles.pendingBadge}>Pending</span>
                    )}
                  </div>
                ))
              ) : (
                <div className={styles.noTags}>No matching tags found</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
