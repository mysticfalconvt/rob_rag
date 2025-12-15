"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import ChatHeader from "@/components/ChatHeader";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import SourceFilterBar from "@/components/SourceFilterBar";
import Toast from "@/components/Toast";
import { useChat } from "@/hooks/useChat";
import { useConversationActions } from "@/hooks/useConversationActions";
import { config } from "@/lib/config";
import styles from "./page.module.css";

function ChatPageContent() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("conversation");

  const { messages, isLoading, currentConversationId, sendMessage, sendDirectLLM } =
    useChat(conversationId);
  const { isSaving, saveConversation, deleteConversation } =
    useConversationActions(currentConversationId);

  const [input, setInput] = useState("");
  const [useUploaded, setUseUploaded] = useState(true);
  const [useSynced, setUseSynced] = useState(true);
  const [usePaperless, setUsePaperless] = useState(true);
  const [goodreadsUsers, setGoodreadsUsers] = useState<
    Array<{ id: string; name: string; enabled: boolean }>
  >([]);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Fetch Goodreads users
    const fetchGoodreadsUsers = async () => {
      try {
        const res = await fetch("/api/goodreads/users");
        if (res.ok) {
          const users = await res.json();
          setGoodreadsUsers(
            users.map((u: any) => ({ id: u.id, name: u.name, enabled: true })),
          );
        }
      } catch (error) {
        console.error("Error fetching Goodreads users:", error);
      }
    };
    fetchGoodreadsUsers();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const getSourceFilter = ():
    | "all"
    | "none"
    | string[]
    | "uploaded"
    | "synced"
    | "paperless"
    | "goodreads"
    | "custom_ocr" => {
    const activeSources = [];
    if (useUploaded) activeSources.push("uploaded");
    if (useSynced) activeSources.push("synced");
    if (usePaperless) {
      activeSources.push("paperless");
      activeSources.push("custom_ocr"); // Include custom OCR documents with paperless
    }

    // Add enabled Goodreads users with format "goodreads:userId"
    const enabledGoodreadsUsers = goodreadsUsers.filter((u) => u.enabled);
    enabledGoodreadsUsers.forEach((u) => {
      activeSources.push(`goodreads:${u.id}`);
    });

    const totalPossibleSources = 3 + goodreadsUsers.length; // uploaded, synced, paperless + all goodreads users
    if (
      activeSources.length === totalPossibleSources + 1 && // +1 for custom_ocr added with paperless
      totalPossibleSources > 0
    )
      return "all";
    if (activeSources.length === 0) return "none";
    if (activeSources.length === 1) {
      return activeSources[0] as
        | "uploaded"
        | "synced"
        | "paperless"
        | "goodreads"
        | "custom_ocr";
    }
    // Multiple sources selected: return array for OR filtering
    return activeSources;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const sourceFilter = getSourceFilter();
    await sendMessage(input, sourceFilter);
    setInput("");
  };

  const handleDirectLLMSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    await sendDirectLLM(input);
    setInput("");
  };

  const handleSaveConversation = async () => {
    setShowSettings(false);
    const result = await saveConversation();
    setToast({
      message: result.message,
      type: result.success ? "success" : "error",
    });
  };

  const handleDeleteConversation = async () => {
    setShowSettings(false);
    const result = await deleteConversation();
    setToast({
      message: result.message,
      type: result.success ? "success" : "error",
    });
  };

  const handleToggleGoodreadsUser = (userId: string) => {
    setGoodreadsUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, enabled: !u.enabled } : u)),
    );
  };

  return (
    <div className={styles.container}>
      <ChatHeader
        conversationId={null}
        showMenu={false}
        isSaving={false}
        appName={config.APP_NAME}
        onToggleMenu={() => {}}
        onSaveConversation={() => {}}
        onDeleteConversation={() => {}}
      />

      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            <i className="fas fa-comments fa-3x"></i>
            <p>Ask a question to get started!</p>
          </div>
        )}

        {messages.map((msg, index) => (
          <ChatMessage key={index} message={msg} />
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

      <div className={styles.inputContainer}>
        {/* <SourceFilterBar
          useUploaded={useUploaded}
          useSynced={useSynced}
          usePaperless={usePaperless}
          useGoodreads={useGoodreads}
          onToggleUploaded={() => setUseUploaded(!useUploaded)}
          onToggleSynced={() => setUseSynced(!useSynced)}
          onTogglePaperless={() => setUsePaperless(!usePaperless)}
          onToggleGoodreads={() => setUseGoodreads(!useGoodreads)}
        /> */}
        <ChatInput
          value={input}
          isLoading={isLoading}
          showSettings={showSettings}
          useUploaded={useUploaded}
          useSynced={useSynced}
          usePaperless={usePaperless}
          goodreadsUsers={goodreadsUsers}
          conversationId={currentConversationId}
          isSaving={isSaving}
          onChange={setInput}
          onSubmit={handleSubmit}
          onDirectLLMSubmit={handleDirectLLMSubmit}
          onToggleSettings={() => setShowSettings(!showSettings)}
          onToggleUploaded={() => setUseUploaded(!useUploaded)}
          onToggleSynced={() => setUseSynced(!useSynced)}
          onTogglePaperless={() => setUsePaperless(!usePaperless)}
          onToggleGoodreadsUser={handleToggleGoodreadsUser}
          onSaveConversation={handleSaveConversation}
          onDeleteConversation={handleDeleteConversation}
        />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
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
