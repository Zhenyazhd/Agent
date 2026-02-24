import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, Settings, Role, AgentStep, AgentActivity } from '../types';
import { runAgentStream } from '../api/client';

interface UseChatOptions {
  settings: Settings;
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

// Batch UI updates: at most one React render per this interval (ms)
const FLUSH_INTERVAL_MS = 50;

export function useChat({ settings }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentActivity>(defaultAgentActivity);
  const [allSteps, setAllSteps] = useState<AgentStep[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const agentStepsRef = useRef<AgentStep[]>([]);

  const pendingStepsRef = useRef<AgentStep[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalAnswerRef = useRef('');

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setAgentActivity(defaultAgentActivity);
    setAllSteps([]);
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
    setAgentActivity((prev) => ({ ...prev, isActive: false, currentStep: null }));
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  const flushPendingSteps = useCallback((assistantId: string) => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const batch = pendingStepsRef.current;
    pendingStepsRef.current = [];
    if (batch.length === 0) return;

    agentStepsRef.current = [...agentStepsRef.current, ...batch];
    const allCurrentSteps = agentStepsRef.current;
    const lastStep = batch[batch.length - 1];
    const currentFinalAnswer = finalAnswerRef.current;

    let newIteration: number | undefined;
    for (const step of batch) {
      if (step.step_type === 'thinking' && step.content.startsWith('Iteration')) {
        newIteration = parseInt(step.content.match(/\d+/)?.[0] || '0');
      }
    }

    setAllSteps((prev) => [...prev, ...batch]);
    setAgentActivity((prev) => ({
      ...prev,
      currentStep: lastStep,
      iteration: newIteration !== undefined ? newIteration : prev.iteration,
      steps: allCurrentSteps,
    }));
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? { ...m, content: currentFinalAnswer, steps: allCurrentSteps }
          : m
      )
    );
  }, []);

  const scheduleFlush = useCallback(
    (assistantId: string) => {
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = setTimeout(() => {
        flushPendingSteps(assistantId);
      }, FLUSH_INTERVAL_MS);
    },
    [flushPendingSteps]
  );

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
        conversation = next.map((m) => ({ role: m.role as Role, content: m.content }));
        return next;
      });

      setIsLoading(true);
      setError(null);

      const assistantId = generateId();
      assistantIdRef.current = assistantId;

      agentStepsRef.current = [];
      pendingStepsRef.current = [];
      finalAnswerRef.current = '';
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', timestamp: new Date().toISOString(), steps: [] },
      ]);
      setAgentActivity({ isActive: true, currentStep: null, iteration: 0, steps: [] });

      const request = {
        message: content.trim(),
        conversation,
        system_prompt: settings.systemPrompt || undefined,
        model: settings.model || undefined,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        mode: settings.mode,
      };

      try {
        const stream = runAgentStream(request, settings.apiUrl, abortController.signal);

        for await (const chunk of stream) {
          const step: AgentStep = {
            ...chunk.step,
            timestamp: chunk.step.timestamp ?? new Date().toISOString(),
          };

          if (step.step_type === 'final_answer') {
            finalAnswerRef.current = step.content;
          }

          pendingStepsRef.current = [...pendingStepsRef.current, step];

          if (step.step_type === 'error') {
            flushPendingSteps(assistantId);
            setError(step.content);
            setAgentActivity((prev) => ({ ...prev, isActive: false, currentStep: null }));
            setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content.trim() !== ''));
            return;
          }

          scheduleFlush(assistantId);
        }

        flushPendingSteps(assistantId);
        setAgentActivity((prev) => ({ ...prev, isActive: false, currentStep: null }));
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
        assistantIdRef.current = null;
      }
    },
    [settings, isLoading, flushPendingSteps, scheduleFlush]
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
