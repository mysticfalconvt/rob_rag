"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

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

export function useChat(conversationId: string | null) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(conversationId);

  useEffect(() => {
    const loadConversation = async () => {
      if (conversationId) {
        try {
          const res = await fetch(`/api/conversations/${conversationId}`);
          if (res.ok) {
            const data = await res.json();
            const loadedMessages = data.messages.map((msg: any) => {
              const sources = msg.sources ? JSON.parse(msg.sources) : undefined;
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
        setMessages([]);
        setCurrentConversationId(null);
      }
    };

    loadConversation();
  }, [conversationId]);

  const sendMessage = async (
    input: string,
    sourceFilter:
      | "all"
      | "uploaded"
      | "synced"
      | "paperless"
      | "goodreads"
      | "none"
      | string[],
    sourceCount: number = 5,
  ) => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          conversationId: currentConversationId,
          sourceFilter,
          sourceCount,
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

        if (buffer.includes("__SOURCES__:")) {
          const [contentPart, sourcesPart] = buffer.split("__SOURCES__:");

          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              content: contentPart.trim(),
            };
            return newMessages;
          });

          try {
            const sourcesData = JSON.parse(sourcesPart);
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastIndex = newMessages.length - 1;
              newMessages[lastIndex] = {
                ...newMessages[lastIndex],
                sources: sourcesData.sources,
              };
              return newMessages;
            });

            if (sourcesData.conversationId && !currentConversationId) {
              setCurrentConversationId(sourcesData.conversationId);
              router.push(`/?conversation=${sourcesData.conversationId}`);
            }
          } catch (e) {
            console.error("Failed to parse sources:", e);
          }
          break;
        }

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

  return {
    messages,
    isLoading,
    currentConversationId,
    sendMessage,
  };
}
