import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, Settings, Role, AgentStep, AgentActivity } from '../types';
import { sendMessage, sendMessageStream, runAgentStream } from '../api/client';

interface UseChatOptions {
  settings: Settings;
  streaming?: boolean;
}

interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  agentActivity: AgentActivity;
  allSteps: AgentStep[];
  sendUserMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => void;
  clearError: () => void;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

const defaultAgentActivity: AgentActivity = {
  isActive: false,
  currentStep: null,
  iteration: 0,
  steps: [],
};

export function useChat({ settings, streaming = true }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentActivity>(defaultAgentActivity);
  const [allSteps, setAllSteps] = useState<AgentStep[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<string>('');
  const assistantIdRef = useRef<string | null>(null);
  const agentStepsRef = useRef<AgentStep[]>([]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setAgentActivity(defaultAgentActivity);
    setAllSteps([]);
    bufferRef.current = '';
    assistantIdRef.current = null;
    agentStepsRef.current = [];
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setAgentActivity((prev) => ({
      ...prev,
      isActive: false,
      currentStep: null,
    }));
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
          // Use streaming for agent mode
          const assistantId = generateId();
          assistantIdRef.current = assistantId;
          agentStepsRef.current = [];

          const assistantMessage: Message = {
            id: assistantId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            steps: [],
          };

          setMessages((prev) => [...prev, assistantMessage]);

          setAgentActivity({
            isActive: true,
            currentStep: null,
            iteration: 0,
            steps: [],
          });

          const stream = runAgentStream(request, settings.apiUrl, abortController.signal);
          let finalAnswer = '';

          console.log('[useChat] Starting agent stream...');

          for await (const chunk of stream) {
            const rawStep = chunk.step;
            const step: AgentStep = {
              ...rawStep,
              timestamp: rawStep.timestamp ?? new Date().toISOString(),
            };
            console.log('[useChat] Received step:', step.step_type);
            agentStepsRef.current = [...agentStepsRef.current, step];

            setAllSteps((prev) => [...prev, step]);

            setAgentActivity((prev) => ({
              ...prev,
              currentStep: step,
              iteration: step.step_type === 'thinking' && step.content.startsWith('Iteration')
                ? parseInt(step.content.match(/\d+/)?.[0] || '0')
                : prev.iteration,
              steps: agentStepsRef.current,
            }));

            if (step.step_type === 'error') {
              setError(step.content);
              // Keep the steps visible, just mark as inactive
              setAgentActivity((prev) => ({
                ...prev,
                isActive: false,
                currentStep: null,
              }));
              setMessages((prev) =>
                prev.filter((m) => m.id !== assistantId || m.content.trim() !== '')
              );
              return;
            }

            if (step.step_type === 'final_answer') {
              finalAnswer = step.content;
            }

            const currentSteps = [...agentStepsRef.current];
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId  
                  ? {
                      ...m,
                      content: finalAnswer,
                      steps: currentSteps,
                    }
                  : m
              )
            );
          }

          // Keep the steps visible after completion
          setAgentActivity((prev) => ({
            ...prev,
            isActive: false,
            currentStep: null,
          }));
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
              const currentContent = bufferRef.current;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId  // Use local variable, not ref
                    ? { ...m, content: currentContent }
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
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);
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
    agentActivity,
    allSteps,
    sendUserMessage,
    stopGeneration,
    clearMessages,
    clearError,
  };
}
