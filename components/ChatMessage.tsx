"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SourceCitation from "@/components/SourceCitation";
import type { Source } from "@/types/source";
import styles from "./ChatMessage.module.css";

interface ActivityStep {
  tool?: string;
  label: string;
  status: "running" | "done" | "error";
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  steps?: ActivityStep[];
}

interface ChatMessageProps {
  message: Message;
}

function StepIcon({ status }: { status: ActivityStep["status"] }) {
  if (status === "running")
    return <i className={`fas fa-spinner fa-spin ${styles.stepIconRunning}`} />;
  if (status === "error")
    return (
      <i className={`fas fa-triangle-exclamation ${styles.stepIconError}`} />
    );
  return <i className={`fas fa-check ${styles.stepIconDone}`} />;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const steps = message.steps ?? [];
  return (
    <div className={`${styles.message} ${styles[message.role]}`}>
      <div className={styles.avatar}>
        {message.role === "user" ? (
          <i className="fas fa-user"></i>
        ) : (
          <i className="fas fa-robot"></i>
        )}
      </div>
      <div className={styles.content}>
        {message.role === "assistant" && steps.length > 0 && (
          <ul className={styles.activity}>
            {steps.map((step, i) => (
              <li
                key={i}
                className={`${styles.step} ${step.status === "running" ? styles.stepActive : ""}`}
              >
                <StepIcon status={step.status} />
                <span>{step.label}</span>
              </li>
            ))}
          </ul>
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
        {message.role === "assistant" && message.sources && (
          <SourceCitation sources={message.sources} />
        )}
      </div>
    </div>
  );
}
