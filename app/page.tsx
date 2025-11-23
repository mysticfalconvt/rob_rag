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
import styles from "./page.module.css";

function ChatPageContent() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("conversation");

  const { messages, isLoading, currentConversationId, sendMessage } =
    useChat(conversationId);
  const { isSaving, saveConversation, deleteConversation } =
    useConversationActions(currentConversationId);

  const [input, setInput] = useState("");
  const [useUploaded, setUseUploaded] = useState(true);
  const [useSynced, setUseSynced] = useState(true);
  const [usePaperless, setUsePaperless] = useState(true);
  const [useGoodreads, setUseGoodreads] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
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
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const getSourceFilter = () => {
    const activeSources = [];
    if (useUploaded) activeSources.push("uploaded");
    if (useSynced) activeSources.push("synced");
    if (usePaperless) activeSources.push("paperless");
    if (useGoodreads) activeSources.push("goodreads");

    if (activeSources.length === 4) return "all";
    if (activeSources.length === 1)
      return activeSources[0] as
        | "uploaded"
        | "synced"
        | "paperless"
        | "goodreads";
    if (activeSources.length === 0) return "none";
    return "all"; // Multiple sources selected
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const sourceFilter = getSourceFilter();
    await sendMessage(input, sourceFilter);
    setInput("");
  };

  const handleSaveConversation = async () => {
    setShowMenu(false);
    const result = await saveConversation();
    setToast({
      message: result.message,
      type: result.success ? "success" : "error",
    });
  };

  const handleDeleteConversation = async () => {
    setShowMenu(false);
    const result = await deleteConversation();
    setToast({
      message: result.message,
      type: result.success ? "success" : "error",
    });
  };

  return (
    <div className={styles.container}>
      <ChatHeader
        conversationId={currentConversationId}
        showMenu={showMenu}
        isSaving={isSaving}
        onToggleMenu={() => setShowMenu(!showMenu)}
        onSaveConversation={handleSaveConversation}
        onDeleteConversation={handleDeleteConversation}
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
        <SourceFilterBar
          useUploaded={useUploaded}
          useSynced={useSynced}
          usePaperless={usePaperless}
          useGoodreads={useGoodreads}
          onToggleUploaded={() => setUseUploaded(!useUploaded)}
          onToggleSynced={() => setUseSynced(!useSynced)}
          onTogglePaperless={() => setUsePaperless(!usePaperless)}
          onToggleGoodreads={() => setUseGoodreads(!useGoodreads)}
        />
        <ChatInput
          value={input}
          isLoading={isLoading}
          onChange={setInput}
          onSubmit={handleSubmit}
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
