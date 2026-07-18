"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Source } from "@/types/source";

export interface ActivityStep {
  tool?: string;
  label: string;
  status: "running" | "done" | "error";
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  /** Live activity trace (tool calls / progress) for assistant messages. */
  steps?: ActivityStep[];
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
  const [abortControllerRef, setAbortController] =
    useState<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );

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

      // Push the assistant message up front so activity steps can stream into it
      // before the first answer token arrives.
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", steps: [] },
      ]);

      // Local accumulators mirrored into the last message on each event.
      let content = "";
      let steps: ActivityStep[] = [];
      const patchLast = (patch: Partial<Message>) =>
        setMessages((prev) => {
          const next = [...prev];
          const i = next.length - 1;
          next[i] = { ...next[i], ...patch };
          return next;
        });

      const markRunningDone = () => {
        let changed = false;
        steps = steps.map((s) => {
          if (s.status === "running") {
            changed = true;
            return { ...s, status: "done" as const };
          }
          return s;
        });
        return changed;
      };

      const handleEvent = (ev: any) => {
        if (ev.type === "token") {
          if (steps.some((s) => s.status === "running")) markRunningDone();
          content += ev.value ?? "";
          patchLast({ content, steps });
        } else if (ev.type === "status") {
          if (ev.kind === "thinking") {
            steps = [...steps, { label: ev.label, status: "running" }];
          } else if (ev.kind === "tool_start") {
            const last = steps[steps.length - 1];
            if (last && last.label === ev.label) {
              // Collapse consecutive identical activity into one line.
              steps = steps.map((s, i) =>
                i === steps.length - 1
                  ? { ...s, status: "running" as const }
                  : s,
              );
            } else {
              markRunningDone();
              steps = [
                ...steps,
                { tool: ev.tool, label: ev.label, status: "running" },
              ];
            }
          } else if (ev.kind === "tool_end") {
            // Mark the matching running step done/error.
            let matched = false;
            steps = steps.map((s) => {
              if (!matched && s.status === "running" && s.tool === ev.tool) {
                matched = true;
                return {
                  ...s,
                  status:
                    ev.ok === false ? ("error" as const) : ("done" as const),
                };
              }
              return s;
            });
          }
          patchLast({ steps });
        } else if (ev.type === "sources") {
          markRunningDone();
          patchLast({ sources: ev.sources, steps });
          if (ev.conversationId && !currentConversationId) {
            setCurrentConversationId(ev.conversationId);
            const params = new URLSearchParams();
            params.set("conversation", ev.conversationId);
            if (documentPath) params.set("document", documentPath);
            router.push(`/?${params.toString()}`);
          }
        }
      };

      const decoder = new TextDecoder();
      let buffer = "";
      const drain = (flush: boolean) => {
        const lines = buffer.split("\n");
        buffer = flush ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            handleEvent(JSON.parse(trimmed));
          } catch {
            // Ignore malformed/partial lines.
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          drain(true);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        drain(false);
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        // Request was cancelled — keep the assistant bubble but mark it stopped
        // (and stop any spinning activity steps) instead of blanking it out.
        setMessages((prev) => {
          const next = [...prev];
          const i = next.length - 1;
          const last = next[i];
          if (last?.role === "assistant") {
            const steps = (last.steps || []).map((s) =>
              s.status === "running" ? { ...s, status: "done" as const } : s,
            );
            const note = "_⏹ Stopped by user._";
            next[i] = {
              ...last,
              content: last.content?.trim()
                ? `${last.content}\n\n${note}`
                : note,
              steps,
            };
          }
          return next;
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
    cancelRequest,
  };
}
