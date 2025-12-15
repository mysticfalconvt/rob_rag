"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import styles from "./Sidebar.module.css";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  _count: { messages: number };
}

interface SidebarContentProps {
  appName: string;
}

function SidebarContent({ appName }: SidebarContentProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentConversationId = searchParams.get("conversation");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();

  const isActive = (path: string) => pathname === path;

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const res = await fetch("/api/conversations");
        if (res.ok) {
          const data = await res.json();
          setConversations(data);
        }
      } catch (error) {
        console.error("Failed to fetch conversations:", error);
      }
    };

    fetchConversations();
    // Refresh conversations every 5 seconds when on chat page
    const interval = setInterval(fetchConversations, 5000);

    // Listen for custom event to open mobile menu
    const handleOpenMenu = () => {
      setIsMobileMenuOpen(true);
    };
    window.addEventListener("openMobileMenu" as any, handleOpenMenu);

    return () => {
      clearInterval(interval);
      window.removeEventListener("openMobileMenu" as any, handleOpenMenu);
    };
  }, []);

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm("Delete this conversation?")) return;

    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        // If deleting current conversation, redirect to new chat
        if (id === currentConversationId) {
          window.location.href = "/";
        }
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      {/* Hamburger Menu Button - Mobile Only */}
      <button
        className={styles.hamburger}
        onClick={() => setIsMobileMenuOpen(true)}
        aria-label="Open menu"
      >
        <i className="fas fa-bars"></i>
      </button>

      {/* Backdrop Overlay - Mobile Only */}
      {isMobileMenuOpen && (
        <div className={styles.backdrop} onClick={closeMobileMenu} />
      )}

      <aside
        className={`${styles.sidebar} ${isMobileMenuOpen ? styles.open : ""}`}
      >
        <div className={styles.sidebarHeader}>
          <div className={styles.logo}>
            <i className="fas fa-robot"></i>
            <span>{appName}</span>
          </div>
          <button
            className={styles.closeButton}
            onClick={closeMobileMenu}
            aria-label="Close menu"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <nav className={styles.nav}>
          <Link
            href="/"
            className={`${styles.link} ${isActive("/") && !currentConversationId ? styles.active : ""}`}
            onClick={closeMobileMenu}
          >
            <i className="fas fa-plus"></i>
            <span>New Chat</span>
          </Link>

          <Link
            href="/files"
            className={`${styles.link} ${isActive("/files") ? styles.active : ""}`}
            onClick={closeMobileMenu}
          >
            <i className="fas fa-folder-open"></i>
            <span>Files</span>
          </Link>

          <Link
            href="/status"
            className={`${styles.link} ${isActive("/status") ? styles.active : ""}`}
            onClick={closeMobileMenu}
          >
            <i className="fas fa-server"></i>
            <span>Status</span>
          </Link>

          <Link
            href="/tags"
            className={`${styles.link} ${isActive("/tags") ? styles.active : ""}`}
            onClick={closeMobileMenu}
          >
            <i className="fas fa-tags"></i>
            <span>Tags</span>
          </Link>

          <Link
            href="/config"
            className={`${styles.link} ${isActive("/config") ? styles.active : ""}`}
            onClick={closeMobileMenu}
          >
            <i className="fas fa-cog"></i>
            <span>Config</span>
          </Link>

          {user?.role === "admin" && (
            <>
              <Link
                href="/admin/dashboard"
                className={`${styles.link} ${isActive("/admin/dashboard") ? styles.active : ""}`}
                onClick={closeMobileMenu}
              >
                <i className="fas fa-chart-line"></i>
                <span>Dashboard</span>
              </Link>
              <Link
                href="/admin/users"
                className={`${styles.link} ${isActive("/admin/users") ? styles.active : ""}`}
                onClick={closeMobileMenu}
              >
                <i className="fas fa-users-cog"></i>
                <span>Manage Users</span>
              </Link>
            </>
          )}
        </nav>

        <div className={styles.searchContainer}>
          <input
            type="text"
            placeholder="Search conversations..."
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {conversations.length > 0 && (
          <div className={styles.conversations}>
            <div className={styles.conversationsHeader}>Recent Chats</div>
            <div className={styles.conversationsList}>
              {conversations
                .filter((conv) =>
                  conv.title.toLowerCase().includes(searchQuery.toLowerCase()),
                )
                .map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/?conversation=${conv.id}`}
                    className={`${styles.conversationItem} ${conv.id === currentConversationId ? styles.activeConversation : ""}`}
                    title={conv.title}
                    onClick={closeMobileMenu}
                  >
                    <div className={styles.conversationContent}>
                      <div className={styles.conversationTitle}>
                        {conv.title}
                      </div>
                      <div className={styles.conversationMeta}>
                        {formatRelativeTime(conv.updatedAt)} ·{" "}
                        {conv._count.messages} msgs
                      </div>
                    </div>
                    <button
                      className={styles.deleteButton}
                      onClick={(e) => handleDeleteConversation(conv.id, e)}
                      title="Delete conversation"
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  </Link>
                ))}
            </div>
          </div>
        )}

        <div className={styles.footer}>
          {user && (
            <div className={styles.userSection}>
              <div className={styles.userInfo}>
                <i className="fas fa-user-circle"></i>
                <div className={styles.userDetails}>
                  <div className={styles.userName}>{user.name}</div>
                  <div className={styles.userEmail}>{user.email}</div>
                </div>
              </div>
              <button
                className={styles.logoutButton}
                onClick={logout}
                title="Logout"
              >
                <i className="fas fa-sign-out-alt"></i>
              </button>
            </div>
          )}
          <p>v0.1.0</p>
        </div>
      </aside>
    </>
  );
}

interface SidebarProps {
  appName: string;
}

export default function Sidebar({ appName }: SidebarProps) {
  return (
    <Suspense fallback={<div className={styles.sidebar}>Loading...</div>}>
      <SidebarContent appName={appName} />
    </Suspense>
  );
}
