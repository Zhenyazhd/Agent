import { useState, useCallback } from 'react';
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

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const sendUserMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: content.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      const conversation = messages.map((m) => ({
        role: m.role as Role,
        content: m.content,
      }));

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
          // Agent mode with tools
          const response = await runAgent(request, settings.apiUrl);

          const assistantMessage: Message = {
            id: response.id,
            role: 'assistant',
            content: response.final_answer,
            timestamp: new Date(),
            steps: response.steps,
          };

          setMessages((prev) => [...prev, assistantMessage]);
        } else if (streaming) {
          // Streaming response
          const assistantMessage: Message = {
            id: generateId(),
            role: 'assistant',
            content: '',
            timestamp: new Date(),
          };

          setMessages((prev) => [...prev, assistantMessage]);

          const stream = sendMessageStream(request, settings.apiUrl);

          for await (const chunk of stream) {
            if (chunk.content) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: m.content + chunk.content }
                    : m
                )
              );
            }
          }
        } else {
          // Non-streaming response
          const response = await sendMessage(request, settings.apiUrl);

          const assistantMessage: Message = {
            id: response.id,
            role: 'assistant',
            content: response.message,
            timestamp: new Date(),
          };

          setMessages((prev) => [...prev, assistantMessage]);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);
        // Remove the empty assistant message on error (for streaming)
        setMessages((prev) => prev.filter((m) => m.content.trim() !== ''));
      } finally {
        setIsLoading(false);
      }
    },
    [messages, settings, streaming, isLoading]
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
