import { useState, useCallback, useRef, useEffect } from 'react';
import type { AgentActivity, AgentStep, Settings } from '../types';
import { runAgentStream } from '../api/client';

const defaultActivity: AgentActivity = {
  isActive: false,
  currentStep: null,
  iteration: 0,
  steps: [],
};

export interface UsePipelineReturn {
  isRunning: boolean;
  agentActivity: AgentActivity;
  finalAnswer: string;
  error: string | null;
  run: (chainId: string, txHashes: string[]) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function usePipeline({ settings }: { settings: Settings }): UsePipelineReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [agentActivity, setAgentActivity] = useState<AgentActivity>(defaultActivity);
  const [finalAnswer, setFinalAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const run = useCallback(async (chainId: string, txHashes: string[]) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setIsRunning(true);
    setError(null);
    setFinalAnswer('');
    setAgentActivity({ isActive: true, currentStep: null, iteration: 0, steps: [] });

    // Serialize params as JSON in the message field — backend parses this directly
    const message = JSON.stringify({ chain_id: chainId, tx_hashes: txHashes });

    try {
      const stream = runAgentStream(
        { message, conversation: [], model: settings.model, mode: settings.mode },
        settings.apiUrl,
        abort.signal,
      );

      const accumulated: AgentStep[] = [];

      for await (const chunk of stream) {
        const step = chunk.step;
        accumulated.push(step);

        if (step.step_type === 'final_answer') {
          setFinalAnswer(step.content);
        }

        setAgentActivity({
          isActive: step.step_type !== 'final_answer' && step.step_type !== 'error',
          currentStep: step,
          iteration: 0,
          steps: [...accumulated],
        });

        if (step.step_type === 'error') {
          setError(step.content);
          break;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
      setAgentActivity((prev) => ({ ...prev, isActive: false }));
    }
  }, [settings]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setAgentActivity((prev) => ({ ...prev, isActive: false }));
  }, []);

  const reset = useCallback(() => {
    setAgentActivity(defaultActivity);
    setFinalAnswer('');
    setError(null);
  }, []);

  return { isRunning, agentActivity, finalAnswer, error, run, stop, reset };
}
