"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import styles from "./page.module.css";

interface Tag {
  id: string;
  name: string;
  status: string;
  color?: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function TagsPage() {
  const { isAdmin } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "approved" | "pending">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editedTagName, setEditedTagName] = useState("");
  const [mergingTag, setMergingTag] = useState<Tag | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [newTagName, setNewTagName] = useState("");

  const fetchTags = async () => {
    try {
      const url = filter === "all" ? "/api/tags" : `/api/tags?status=${filter}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setTags(data);
      }
    } catch (error) {
      console.error("Error fetching tags:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, [filter]);

  const handleApprove = async (tagId: string) => {
    try {
      const res = await fetch(`/api/tags/${tagId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (res.ok) {
        await fetchTags();
      }
    } catch (error) {
      console.error("Error approving tag:", error);
    }
  };

  const handleDelete = async (tagId: string, tagName: string) => {
    if (!confirm(`Delete tag "${tagName}"? This will remove it from all documents.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/tags/${tagId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchTags();
      }
    } catch (error) {
      console.error("Error deleting tag:", error);
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTagName,
          status: "approved", // Manually created tags are auto-approved
        }),
      });
      if (res.ok) {
        setNewTagName("");
        await fetchTags();
      } else {
        const error = await res.json();
        alert(error.error || "Failed to create tag");
      }
    } catch (error) {
      console.error("Error creating tag:", error);
    }
  };

  const handleStartEdit = (tag: Tag) => {
    setEditingTag(tag);
    setEditedTagName(tag.name);
  };

  const handleSaveEdit = async () => {
    if (!editingTag || !editedTagName.trim()) return;

    try {
      const res = await fetch(`/api/tags/${editingTag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editedTagName,
        }),
      });
      if (res.ok) {
        setEditingTag(null);
        setEditedTagName("");
        await fetchTags();
      } else {
        const error = await res.json();
        alert(error.error || "Failed to update tag");
      }
    } catch (error) {
      console.error("Error updating tag:", error);
    }
  };

  const handleCancelEdit = () => {
    setEditingTag(null);
    setEditedTagName("");
  };

  const handleStartMerge = (tag: Tag) => {
    setMergingTag(tag);
    setMergeTargetId("");
  };

  const handleMerge = async () => {
    if (!mergingTag || !mergeTargetId) return;

    const targetTag = tags.find((t) => t.id === mergeTargetId);
    if (!targetTag) return;

    if (
      !confirm(
        `Merge "${mergingTag.name}" into "${targetTag.name}"?\n\n` +
          `All ${mergingTag.documentCount} documents tagged with "${mergingTag.name}" will be retagged to "${targetTag.name}".\n` +
          `The tag "${mergingTag.name}" will be deleted.\n\n` +
          `This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/tags/${mergingTag.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetTagId: mergeTargetId,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        alert(`✅ ${result.message}\n${result.documentsUpdated} documents updated.`);
        setMergingTag(null);
        setMergeTargetId("");
        await fetchTags();
      } else {
        const error = await res.json();
        alert(error.error || "Failed to merge tags");
      }
    } catch (error) {
      console.error("Error merging tags:", error);
    }
  };

  const handleCancelMerge = () => {
    setMergingTag(null);
    setMergeTargetId("");
  };

  const filteredTags = tags.filter((tag) =>
    tag.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pendingCount = tags.filter((t) => t.status === "pending").length;
  const approvedCount = tags.filter((t) => t.status === "approved").length;

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading tags...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Tag Management</h1>
        <div className={styles.stats}>
          <span className={styles.stat}>
            Total: <strong>{tags.length}</strong>
          </span>
          <span className={styles.stat}>
            Approved: <strong>{approvedCount}</strong>
          </span>
          {pendingCount > 0 && (
            <span className={`${styles.stat} ${styles.pending}`}>
              Pending: <strong>{pendingCount}</strong>
            </span>
          )}
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.filterButtons}>
          <button
            className={`${styles.filterButton} ${filter === "all" ? styles.active : ""}`}
            onClick={() => setFilter("all")}
          >
            All Tags
          </button>
          <button
            className={`${styles.filterButton} ${filter === "approved" ? styles.active : ""}`}
            onClick={() => setFilter("approved")}
          >
            Approved
          </button>
          <button
            className={`${styles.filterButton} ${filter === "pending" ? styles.active : ""}`}
            onClick={() => setFilter("pending")}
          >
            Pending {pendingCount > 0 && `(${pendingCount})`}
          </button>
        </div>

        <input
          type="text"
          placeholder="Search tags..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      {isAdmin && (
        <div className={styles.createTag}>
          <input
            type="text"
            placeholder="New tag name..."
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleCreateTag()}
            className={styles.input}
          />
          <button onClick={handleCreateTag} className={styles.createButton}>
            <i className="fas fa-plus"></i> Create Tag
          </button>
        </div>
      )}

      {editingTag && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2>Edit Tag</h2>
            <p className={styles.modalSubtitle}>
              Editing: <strong>{editingTag.name}</strong>
            </p>
            <input
              type="text"
              value={editedTagName}
              onChange={(e) => setEditedTagName(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSaveEdit()}
              className={styles.input}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button onClick={handleSaveEdit} className={styles.saveButton}>
                <i className="fas fa-save"></i> Save
              </button>
              <button onClick={handleCancelEdit} className={styles.cancelButton}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {mergingTag && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2>Merge Tag</h2>
            <p className={styles.modalSubtitle}>
              Merging: <strong>{mergingTag.name}</strong> ({mergingTag.documentCount} documents)
            </p>
            <p className={styles.modalDescription}>
              Select the tag to merge into. All documents tagged with "{mergingTag.name}" will be retagged, and "{mergingTag.name}" will be deleted.
            </p>
            <select
              value={mergeTargetId}
              onChange={(e) => setMergeTargetId(e.target.value)}
              className={styles.select}
            >
              <option value="">Select target tag...</option>
              {tags
                .filter((t) => t.id !== mergingTag.id)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name} ({tag.documentCount} documents) {tag.status === "pending" ? "- Pending" : ""}
                  </option>
                ))}
            </select>
            <div className={styles.modalActions}>
              <button
                onClick={handleMerge}
                className={styles.mergeButton}
                disabled={!mergeTargetId}
              >
                <i className="fas fa-code-branch"></i> Merge
              </button>
              <button onClick={handleCancelMerge} className={styles.cancelButton}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.tagList}>
        {filteredTags.length === 0 ? (
          <div className={styles.empty}>No tags found</div>
        ) : (
          filteredTags.map((tag) => (
            <div
              key={tag.id}
              className={`${styles.tagCard} ${tag.status === "pending" ? styles.pendingCard : ""}`}
            >
              <div className={styles.tagInfo}>
                <div className={styles.tagName}>
                  <span className={styles.tagBadge}>{tag.name}</span>
                  {tag.status === "pending" && (
                    <span className={styles.pendingBadge}>Pending</span>
                  )}
                </div>
                <div className={styles.tagMeta}>
                  <span className={styles.docCount}>
                    {tag.documentCount} {tag.documentCount === 1 ? "document" : "documents"}
                  </span>
                  <span className={styles.date}>
                    Created {new Date(tag.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {isAdmin && (
                <div className={styles.actions}>
                  {tag.status === "pending" && (
                    <button
                      onClick={() => handleApprove(tag.id)}
                      className={styles.approveButton}
                      title="Approve tag"
                    >
                      <i className="fas fa-check"></i> Approve
                    </button>
                  )}
                  <button
                    onClick={() => handleStartEdit(tag)}
                    className={styles.editButton}
                    title="Edit tag name"
                  >
                    <i className="fas fa-edit"></i>
                  </button>
                  <button
                    onClick={() => handleStartMerge(tag)}
                    className={styles.mergeButtonSmall}
                    title="Merge with another tag"
                  >
                    <i className="fas fa-code-branch"></i>
                  </button>
                  <button
                    onClick={() => handleDelete(tag.id, tag.name)}
                    className={styles.deleteButton}
                    title="Delete tag"
                  >
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
