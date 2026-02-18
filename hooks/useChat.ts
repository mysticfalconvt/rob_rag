"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Source } from "@/types/source";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

export function useChat(
  conversationId: string | null,
  documentPath: string | null = null,
) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(conversationId);
  const [abortControllerRef, setAbortController] = useState<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

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
      | "custom_ocr"
      | "none"
      | string[],
    documentPath?: string | null,
    webSearchEnabled?: boolean,
  ) => {
    if (!input.trim() || isLoading) return;

    const abortController = new AbortController();
    setAbortController(abortController);

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const body: Record<string, unknown> = {
        messages: [...messages, userMessage],
        conversationId: currentConversationId,
        sourceFilter,
      };
      if (documentPath) body.documentPath = documentPath;
      if (webSearchEnabled) body.webSearchEnabled = true;

      // Detect #search and #research command prefixes
      const trimmedInput = input.trim();
      const lowerInput = trimmedInput.toLowerCase();
      if (lowerInput.startsWith("#search ")) {
        body.webSearchQuery = trimmedInput.substring(8).trim();
      } else if (lowerInput.startsWith("#research ")) {
        body.webResearchQuery = trimmedInput.substring(10).trim();
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      if (!reader) return;
      readerRef.current = reader;

      const assistantMessage: Message = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistantMessage]);

      let buffer = "";
      let foundSourcesMarker = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Stream ended - try to parse sources if we found the marker
          if (foundSourcesMarker && buffer.includes("__SOURCES__:")) {
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
              console.log(
                "[useChat] Parsing sources at stream end, raw data:",
                sourcesPart,
              );
              const sourcesData = JSON.parse(sourcesPart);
              console.log("[useChat] Parsed sources:", sourcesData);
              console.log(
                "[useChat] Sources array length:",
                sourcesData.sources?.length,
              );

              setMessages((prev) => {
                const newMessages = [...prev];
                const lastIndex = newMessages.length - 1;
                newMessages[lastIndex] = {
                  ...newMessages[lastIndex],
                  sources: sourcesData.sources,
                };
                console.log(
                  "[useChat] Updated message with sources:",
                  newMessages[lastIndex],
                );
                return newMessages;
              });

              if (sourcesData.conversationId && !currentConversationId) {
                setCurrentConversationId(sourcesData.conversationId);
                const params = new URLSearchParams();
                params.set("conversation", sourcesData.conversationId);
                if (documentPath) params.set("document", documentPath);
                router.push(`/?${params.toString()}`);
              }
            } catch (e) {
              console.error("Failed to parse sources:", e);
              console.error("Raw sources part:", sourcesPart);
            }
          }
          break;
        }

        const text = new TextDecoder().decode(value);
        buffer += text;

        // Check if we found the sources marker
        if (!foundSourcesMarker && buffer.includes("__SOURCES__:")) {
          foundSourcesMarker = true;
          // Don't break - continue reading to get complete JSON
        }

        // Only update content if we haven't found sources marker yet
        if (!foundSourcesMarker) {
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              content: buffer,
            };
            return newMessages;
          });
        } else {
          // Update content without sources part
          const contentPart = buffer.split("__SOURCES__:")[0];
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              content: contentPart.trim(),
            };
            return newMessages;
          });
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        // Request was cancelled - remove the incomplete assistant message
        setMessages((prev) => {
          const newMessages = [...prev];
          if (newMessages[newMessages.length - 1]?.role === "assistant" &&
            newMessages[newMessages.length - 1]?.content === "") {
            newMessages.pop();
          }
          return newMessages;
        });
      } else {
        console.error("Error:", error);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong." },
        ]);
      }
    } finally {
      setIsLoading(false);
      setAbortController(null);
      readerRef.current = null;
    }
  };

  const sendDirectLLM = async (input: string) => {
    if (!input.trim() || isLoading) return;

    const abortController = new AbortController();
    setAbortController(abortController);

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          messages: [...messages, userMessage],
          conversationId: currentConversationId,
        }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      if (!reader) return;
      readerRef.current = reader;

      const assistantMessage: Message = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistantMessage]);

      let buffer = "";
      let foundSourcesMarker = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Stream ended - try to parse metadata if we found the marker
          if (foundSourcesMarker && buffer.includes("__SOURCES__:")) {
            const [contentPart, metadataPart] = buffer.split("__SOURCES__:");

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
              const metadata = JSON.parse(metadataPart);
              if (metadata.conversationId && !currentConversationId) {
                setCurrentConversationId(metadata.conversationId);
                const params = new URLSearchParams();
                params.set("conversation", metadata.conversationId);
                if (documentPath) params.set("document", documentPath);
                router.push(`/?${params.toString()}`);
              }
            } catch (e) {
              console.error("Failed to parse metadata:", e);
            }
          }
          break;
        }

        const text = new TextDecoder().decode(value);
        buffer += text;

        // Check if we found the sources marker
        if (!foundSourcesMarker && buffer.includes("__SOURCES__:")) {
          foundSourcesMarker = true;
        }

        // Only update content if we haven't found sources marker yet
        if (!foundSourcesMarker) {
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              content: buffer,
            };
            return newMessages;
          });
        } else {
          // Update content without metadata part
          const contentPart = buffer.split("__SOURCES__:")[0];
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              content: contentPart.trim(),
            };
            return newMessages;
          });
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        // Request was cancelled - remove the incomplete assistant message
        setMessages((prev) => {
          const newMessages = [...prev];
          if (newMessages[newMessages.length - 1]?.role === "assistant" &&
            newMessages[newMessages.length - 1]?.content === "") {
            newMessages.pop();
          }
          return newMessages;
        });
      } else {
        console.error("Error:", error);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong." },
        ]);
      }
    } finally {
      setIsLoading(false);
      setAbortController(null);
      readerRef.current = null;
    }
  };

  const cancelRequest = () => {
    if (abortControllerRef) {
      abortControllerRef.abort();
      setAbortController(null);
      setIsLoading(false);
    }
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {
        // Ignore cancellation errors
      });
      readerRef.current = null;
    }
  };

  return {
    messages,
    isLoading,
    currentConversationId,
    sendMessage,
    sendDirectLLM,
    cancelRequest,
  };
}
