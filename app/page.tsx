"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SourceCitation from "@/components/SourceCitation";
import styles from "./page.module.css";

interface Source {
  fileName: string;
  filePath: string;
  chunk: string;
  score: number;
  source?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("conversation");

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(conversationId);
  const [useUploaded, setUseUploaded] = useState(true);
  const [useSynced, setUseSynced] = useState(true);
  const [usePaperless, setUsePaperless] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMenu]);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Load conversation when conversationId changes
  useEffect(() => {
    const loadConversation = async () => {
      if (conversationId) {
        try {
          const res = await fetch(`/api/conversations/${conversationId}`);
          if (res.ok) {
            const data = await res.json();
            const loadedMessages = data.messages.map((msg: any) => {
              const sources = msg.sources ? JSON.parse(msg.sources) : undefined;
              if (sources) {
                console.log("Loaded sources:", sources);
              }
              return {
                role: msg.role,
                content: msg.content,
                sources,
              };
            });
            setMessages(loadedMessages);
            setCurrentConversationId(conversationId);
          }
        } catch (error) {
          console.error("Failed to load conversation:", error);
        }
      } else {
        // New conversation
        setMessages([]);
        setCurrentConversationId(null);
      }
    };

    loadConversation();
  }, [conversationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Determine source filter based on toggles
      let sourceFilter: "all" | "uploaded" | "synced" | "paperless" | "none" =
        "none";
      const activeSources = [];
      if (useUploaded) activeSources.push("uploaded");
      if (useSynced) activeSources.push("synced");
      if (usePaperless) activeSources.push("paperless");

      if (activeSources.length === 3) {
        sourceFilter = "all";
      } else if (activeSources.length === 1) {
        sourceFilter = activeSources[0] as "uploaded" | "synced" | "paperless";
      } else if (activeSources.length === 0) {
        sourceFilter = "none";
      } else {
        // Multiple sources selected - for now use 'all' and let backend handle
        // In future, could pass array of sources
        sourceFilter = "all";
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          conversationId: currentConversationId,
          sourceFilter,
        }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      if (!reader) return;

      const assistantMessage: Message = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistantMessage]);

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        buffer += text;

        // Check if we received the sources marker
        if (buffer.includes("__SOURCES__:")) {
          const [contentPart, sourcesPart] = buffer.split("__SOURCES__:");

          // Update content without the marker
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              content: contentPart.trim(),
            };
            return newMessages;
          });

          // Parse and add sources + update conversation ID
          try {
            const sourcesData = JSON.parse(sourcesPart);
            console.log("Received sources from stream:", sourcesData.sources);
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastIndex = newMessages.length - 1;
              newMessages[lastIndex] = {
                ...newMessages[lastIndex],
                sources: sourcesData.sources,
              };
              return newMessages;
            });

            // Update URL with conversation ID if this is a new conversation
            if (sourcesData.conversationId && !currentConversationId) {
              setCurrentConversationId(sourcesData.conversationId);
              router.push(`/?conversation=${sourcesData.conversationId}`);
            }
          } catch (e) {
            console.error("Failed to parse sources:", e);
          }
          break;
        }

        // Normal streaming update
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastIndex = newMessages.length - 1;
          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            content: buffer,
          };
          return newMessages;
        });
      }
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveConversation = async () => {
    if (!currentConversationId) {
      setToast({
        message: "Please send a message first to create a conversation.",
        type: "error",
      });
      return;
    }

    setIsSaving(true);
    setShowMenu(false);

    try {
      const response = await fetch(
        `/api/conversations/${currentConversationId}/export`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to save conversation");
      }

      const data = await response.json();
      setToast({
        message: `Saved as ${data.filename} and indexed!`,
        type: "success",
      });
    } catch (error) {
      console.error("Error saving conversation:", error);
      setToast({
        message: "Failed to save conversation. Please try again.",
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConversation = async () => {
    if (!currentConversationId) return;

    setShowMenu(false);

    if (!confirm("Delete this conversation?")) return;

    try {
      const res = await fetch(`/api/conversations/${currentConversationId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setToast({
          message: "Conversation deleted successfully!",
          type: "success",
        });
        // Redirect to new chat after a brief delay
        setTimeout(() => {
          router.push("/");
        }, 1000);
      } else {
        throw new Error("Failed to delete conversation");
      }
    } catch (error) {
      console.error("Error deleting conversation:", error);
      setToast({
        message: "Failed to delete conversation. Please try again.",
        type: "error",
      });
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Chat with your Documents</h1>
        {currentConversationId && (
          <div className={styles.menuContainer} ref={menuRef}>
            <button
              className={styles.menuButton}
              onClick={() => setShowMenu(!showMenu)}
              disabled={isSaving}
              title="More options"
            >
              <i className="fas fa-ellipsis-v"></i>
            </button>
            {showMenu && (
              <div className={styles.menuDropdown}>
                <button
                  className={styles.menuItem}
                  onClick={handleSaveConversation}
                  disabled={isSaving}
                >
                  <i className="fas fa-save"></i>
                  {isSaving ? "Saving..." : "Save as Document"}
                </button>
                <button
                  className={`${styles.menuItem} ${styles.danger}`}
                  onClick={handleDeleteConversation}
                >
                  <i className="fas fa-trash"></i>
                  Delete Conversation
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            <i className="fas fa-comments fa-3x"></i>
            <p>Ask a question to get started!</p>
          </div>
        )}

        {messages.map((msg, index) => (
          <div key={index} className={`${styles.message} ${styles[msg.role]}`}>
            <div className={styles.avatar}>
              {msg.role === "user" ? (
                <i className="fas fa-user"></i>
              ) : (
                <i className="fas fa-robot"></i>
              )}
            </div>
            <div className={styles.content}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
              {msg.role === "assistant" && msg.sources && (
                <SourceCitation sources={msg.sources} />
              )}
            </div>
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className={`${styles.message} ${styles.assistant}`}>
            <div className={styles.avatar}>
              <i className="fas fa-robot"></i>
            </div>
            <div className={styles.content}>
              <span className={styles.typing}>Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <div className={styles.filterBar}>
          <span className={styles.filterLabel}>Search in:</span>
          <div className={styles.filterToggles}>
            <button
              type="button"
              className={`${styles.filterToggle} ${useUploaded ? styles.active : ""}`}
              onClick={() => setUseUploaded(!useUploaded)}
            >
              <i className="fas fa-upload"></i>
              Uploaded
              <i
                className={`fas ${useUploaded ? "fa-check-circle" : "fa-circle"}`}
              ></i>
            </button>
            <button
              type="button"
              className={`${styles.filterToggle} ${useSynced ? styles.active : ""}`}
              onClick={() => setUseSynced(!useSynced)}
            >
              <i className="fas fa-sync"></i>
              Synced
              <i
                className={`fas ${useSynced ? "fa-check-circle" : "fa-circle"}`}
              ></i>
            </button>
            <button
              type="button"
              className={`${styles.filterToggle} ${usePaperless ? styles.active : ""}`}
              onClick={() => setUsePaperless(!usePaperless)}
            >
              <i className="fas fa-file-archive"></i>
              Paperless
              <i
                className={`fas ${usePaperless ? "fa-check-circle" : "fa-circle"}`}
              ></i>
            </button>
          </div>
        </div>
        <div className={styles.inputWrapper}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            <i className="fas fa-paper-plane"></i>
          </button>
        </div>
      </form>

      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          <i
            className={`fas ${toast.type === "success" ? "fa-check-circle" : "fa-exclamation-circle"}`}
          ></i>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.container}>
          <div className={styles.header}>
            <h1>Loading...</h1>
          </div>
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
