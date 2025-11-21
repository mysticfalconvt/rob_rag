'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SourceCitation from '@/components/SourceCitation';
import styles from './page.module.css';

interface Source {
  fileName: string;
  filePath: string;
  chunk: string;
  score: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get('conversation');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(conversationId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
                console.log('Loaded sources:', sources);
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
          console.error('Failed to load conversation:', error);
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

    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          conversationId: currentConversationId,
        }),
      });

      if (!response.ok) throw new Error('Failed to send message');

      const reader = response.body?.getReader();
      if (!reader) return;

      const assistantMessage: Message = { role: 'assistant', content: '' };
      setMessages((prev) => [...prev, assistantMessage]);

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        buffer += text;

        // Check if we received the sources marker
        if (buffer.includes('__SOURCES__:')) {
          const [contentPart, sourcesPart] = buffer.split('__SOURCES__:');

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
            console.log('Received sources from stream:', sourcesData.sources);
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
            console.error('Failed to parse sources:', e);
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
      console.error('Error:', error);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Chat with your Documents</h1>
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
              {msg.role === 'user' ? (
                <i className="fas fa-user"></i>
              ) : (
                <i className="fas fa-robot"></i>
              )}
            </div>
            <div className={styles.content}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              {msg.role === 'assistant' && msg.sources && (
                <SourceCitation sources={msg.sources} />
              )}
            </div>
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
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
    </div>
  );
}
