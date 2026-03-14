"use client";

import { useEffect, useState, useCallback } from "react";
import styles from "./DirectoryTreePicker.module.css";

interface DirectoryNode {
  name: string;
  path: string;
  children: DirectoryNode[];
  fileCount: number;
  isSystemExcluded: boolean;
}

interface TreeResponse {
  rootPath: string;
  rootFileCount: number;
  children: DirectoryNode[];
}

interface DirectoryTreePickerProps {
  excludedPaths: string[];
  onExcludedPathsChange: (paths: string[]) => void;
  disabled?: boolean;
}

function getAllDescendantPaths(node: DirectoryNode): string[] {
  const paths = [node.path];
  for (const child of node.children) {
    if (!child.isSystemExcluded) {
      paths.push(...getAllDescendantPaths(child));
    }
  }
  return paths;
}

function getAllPaths(nodes: DirectoryNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (!node.isSystemExcluded) {
      paths.push(...getAllDescendantPaths(node));
    }
  }
  return paths;
}

function TreeNode({
  node,
  excludedPaths,
  onToggle,
  depth,
  disabled,
}: {
  node: DirectoryNode;
  excludedPaths: Set<string>;
  onToggle: (node: DirectoryNode, include: boolean) => void;
  depth: number;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  // Determine check state: checked if included (not excluded)
  const isExcluded = excludedPaths.has(node.path);
  const isChecked = !isExcluded && !node.isSystemExcluded;

  // Check if any descendant is excluded (for indeterminate state)
  const descendantPaths = getAllDescendantPaths(node);
  const someDescendantsExcluded = descendantPaths.some(p => excludedPaths.has(p));
  const allDescendantsExcluded = descendantPaths.every(p => excludedPaths.has(p));
  const isIndeterminate = !node.isSystemExcluded && !isExcluded && someDescendantsExcluded && !allDescendantsExcluded;

  const handleCheckboxChange = () => {
    if (node.isSystemExcluded) return;
    // If currently excluded or partially excluded, include all. Otherwise exclude all.
    const shouldInclude = isExcluded || allDescendantsExcluded;
    onToggle(node, shouldInclude);
  };

  return (
    <div>
      <div
        className={`${styles.nodeRow} ${node.isSystemExcluded ? styles.systemExcluded : ""}`}
      >
        {hasChildren ? (
          <button
            className={styles.toggleBtn}
            onClick={() => setExpanded(!expanded)}
            type="button"
          >
            {expanded ? "\u25BC" : "\u25B6"}
          </button>
        ) : (
          <span className={styles.togglePlaceholder} />
        )}
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={isChecked}
          ref={(el) => {
            if (el) el.indeterminate = isIndeterminate;
          }}
          onChange={handleCheckboxChange}
          disabled={node.isSystemExcluded || disabled}
        />
        <span className={styles.dirName} onClick={() => hasChildren && setExpanded(!expanded)}>
          {node.name}
        </span>
        {node.fileCount > 0 && (
          <span className={styles.fileBadge}>({node.fileCount} files)</span>
        )}
        {node.isSystemExcluded && (
          <span className={styles.systemBadge}>system</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div className={styles.childrenContainer}>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              excludedPaths={excludedPaths}
              onToggle={onToggle}
              depth={depth + 1}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DirectoryTreePicker({
  excludedPaths,
  onExcludedPathsChange,
  disabled,
}: DirectoryTreePickerProps) {
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTree() {
      try {
        const res = await fetch("/api/files/directory-tree");
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load directory tree");
        }
        const data = await res.json();
        setTree(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchTree();
  }, []);

  const excludedSet = new Set(excludedPaths);

  const handleToggle = useCallback(
    (node: DirectoryNode, include: boolean) => {
      const affectedPaths = getAllDescendantPaths(node).filter(
        (p) => {
          // Find the node for this path to check isSystemExcluded
          // For simplicity, just don't touch system-excluded paths
          return true;
        }
      );

      const newExcluded = new Set(excludedPaths);
      if (include) {
        // Remove from excluded
        for (const p of affectedPaths) {
          newExcluded.delete(p);
        }
      } else {
        // Add to excluded
        for (const p of affectedPaths) {
          newExcluded.add(p);
        }
      }
      onExcludedPathsChange(Array.from(newExcluded));
    },
    [excludedPaths, onExcludedPathsChange],
  );

  if (loading) {
    return <div className={styles.loading}>Loading directory tree...</div>;
  }

  if (error) {
    return <div className={styles.error}>Error: {error}</div>;
  }

  if (!tree || tree.children.length === 0) {
    return (
      <div className={styles.loading}>
        No subdirectories found in documents folder.
      </div>
    );
  }

  return (
    <div>
      <div className={styles.rootInfo}>
        Documents root: <span className={styles.rootPath}>{tree.rootPath}</span>
        {tree.rootFileCount > 0 && (
          <span className={styles.fileBadge}> ({tree.rootFileCount} files in root)</span>
        )}
      </div>
      <div className={styles.treeContainer}>
        {tree.children.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            excludedPaths={excludedSet}
            onToggle={handleToggle}
            depth={0}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
