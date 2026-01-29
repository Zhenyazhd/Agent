import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, Settings, Role } from '../types';
import { sendMessage, sendMessageStream, runAgent } from '../api/client';

interface UseChatOptions {
  settings: Settings;
  streaming?: boolean;
}

interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendUserMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function useChat({ settings, streaming = true }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<string>('');
  const assistantIdRef = useRef<string | null>(null);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    bufferRef.current = '';
    assistantIdRef.current = null;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const sendUserMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: content.trim(),
        timestamp: new Date().toISOString(),
      };

      let conversation: Array<{ role: Role; content: string }> = [];

      setMessages((prev) => {
        const next = [...prev, userMessage];
        conversation = next.map((m) => ({
          role: m.role as Role,
          content: m.content,
        }));
        return next;
      });

      setIsLoading(true);
      setError(null);

      const request = {
        message: content.trim(),
        conversation,
        system_prompt: settings.systemPrompt || undefined,
        model: settings.model || undefined,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
      };

      try {
        if (settings.agentMode) {
          const response = await runAgent(request, settings.apiUrl, abortController.signal);

          const assistantMessage: Message = {
            id: response.id,
            role: 'assistant',
            content: response.final_answer,
            timestamp: new Date().toISOString(),
            steps: response.steps,
          };

          setMessages((prev) => [...prev, assistantMessage]);
        } else if (streaming) {
          const assistantId = generateId();
          assistantIdRef.current = assistantId;
          bufferRef.current = '';

          const assistantMessage: Message = {
            id: assistantId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
          };

          setMessages((prev) => [...prev, assistantMessage]);

          const stream = sendMessageStream(request, settings.apiUrl, abortController.signal);

          for await (const chunk of stream) {
            if (chunk.content) {
              bufferRef.current += chunk.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantIdRef.current
                    ? { ...m, content: bufferRef.current }
                    : m
                )
              );
            }
          }
        } else {
          const response = await sendMessage(request, settings.apiUrl, abortController.signal);

          const assistantMessage: Message = {
            id: response.id,
            role: 'assistant',
            content: response.message,
            timestamp: new Date().toISOString(),
          };

          setMessages((prev) => [...prev, assistantMessage]);
        }
      } catch (err) {
        // Don't show error if request was aborted
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);
        // Remove the empty assistant message on error (for streaming)
        setMessages((prev) => prev.filter((m) => m.content.trim() !== ''));
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        bufferRef.current = '';
        assistantIdRef.current = null;
      }
    },
    [settings, streaming, isLoading]
  );

  return {
    messages,
    isLoading,
    error,
    sendUserMessage,
    clearMessages,
    clearError,
  };
}
