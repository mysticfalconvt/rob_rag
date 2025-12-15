"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./TagFilter.module.css";

interface Tag {
  id: string;
  name: string;
  status: string;
}

interface TagFilterProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  taggedFilter: "all" | "tagged" | "untagged";
  onTaggedFilterChange: (filter: "all" | "tagged" | "untagged") => void;
}

export default function TagFilter({
  selectedTags,
  onTagsChange,
  taggedFilter,
  onTaggedFilterChange,
}: TagFilterProps) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTags();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchTags = async () => {
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

  const handleToggleTag = (tagName: string) => {
    if (selectedTags.includes(tagName)) {
      onTagsChange(selectedTags.filter((t) => t !== tagName));
    } else {
      onTagsChange([...selectedTags, tagName]);
    }
  };

  const handleClearTags = () => {
    onTagsChange([]);
    setSearchQuery("");
  };

  const filteredTags = allTags.filter((tag) =>
    tag.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className={styles.container}>
      {/* Tagged/Untagged Filter */}
      <div className={styles.taggedFilter}>
        <button
          className={`${styles.taggedButton} ${taggedFilter === "all" ? styles.active : ""}`}
          onClick={() => onTaggedFilterChange("all")}
        >
          All Files
        </button>
        <button
          className={`${styles.taggedButton} ${taggedFilter === "tagged" ? styles.active : ""}`}
          onClick={() => onTaggedFilterChange("tagged")}
        >
          <i className="fas fa-tags"></i> Tagged
        </button>
        <button
          className={`${styles.taggedButton} ${taggedFilter === "untagged" ? styles.active : ""}`}
          onClick={() => onTaggedFilterChange("untagged")}
        >
          <i className="fas fa-tag"></i> Untagged
        </button>
      </div>

      {/* Tag Selector */}
      <div className={styles.tagSelector} ref={dropdownRef}>
        <button
          className={styles.dropdownButton}
          onClick={() => setIsOpen(!isOpen)}
        >
          <i className="fas fa-filter"></i>
          {selectedTags.length === 0
            ? "Filter by tags..."
            : `${selectedTags.length} tag${selectedTags.length > 1 ? "s" : ""} selected`}
          <i className={`fas fa-chevron-${isOpen ? "up" : "down"}`}></i>
        </button>

        {isOpen && (
          <div className={styles.dropdown}>
            <div className={styles.dropdownHeader}>
              <input
                type="text"
                placeholder="Search tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
              />
              {selectedTags.length > 0 && (
                <button onClick={handleClearTags} className={styles.clearButton}>
                  Clear All
                </button>
              )}
            </div>

            <div className={styles.tagList}>
              {filteredTags.length === 0 ? (
                <div className={styles.emptyMessage}>No tags found</div>
              ) : (
                filteredTags.map((tag) => (
                  <label key={tag.id} className={styles.tagOption}>
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(tag.name)}
                      onChange={() => handleToggleTag(tag.name)}
                    />
                    <span className={styles.tagName}>{tag.name}</span>
                    {tag.status === "pending" && (
                      <span className={styles.pendingBadge}>Pending</span>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selected Tags Display */}
      {selectedTags.length > 0 && (
        <div className={styles.selectedTags}>
          {selectedTags.map((tagName) => (
            <div key={tagName} className={styles.selectedTag}>
              <span>{tagName}</span>
              <button
                onClick={() => handleToggleTag(tagName)}
                className={styles.removeTag}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
