import { useMemo } from 'react';
import type { AgentActivity, NormalizedStep } from '../types';
import { normalizeStep } from '../types';

const STEP_LABELS: Record<string, string> = {
  thinking: 'Thinking',
  tool_call: 'Calling tool',
  tool_result: 'Got result',
  final_answer: 'Finalizing',
  error: 'Error',
};

export interface AgentActivityStats {
  toolCallCount: number;
  thinkingCount: number;
}

export interface UseAgentActivityResult {
  currentLabel: string;
  currentStepLabel: string;
  currentStepTypeLabel: string;
  stats: AgentActivityStats;
  recentSteps: NormalizedStep[];
  normalizedSteps: NormalizedStep[];
  currentNormalized: NormalizedStep | null;
  iteration: number;
  isActive: boolean;
}

const RECENT_STEPS_COUNT = 5;

export function useAgentActivity(activity: AgentActivity): UseAgentActivityResult {
  return useMemo(() => {
    const { steps, currentStep, iteration, isActive } = activity;
    const normalizedSteps = steps.map(normalizeStep);
    const currentNormalized = currentStep ? normalizeStep(currentStep) : null;

    const toolCallCount = normalizedSteps.filter((n) => n.type === 'tool_call').length;
    const thinkingCount = normalizedSteps.filter((n) => n.type === 'thinking' && !n.isMeta).length;
    const stats: AgentActivityStats = { toolCallCount, thinkingCount };

    const currentLabel =
      currentNormalized?.type === 'tool_call' && currentNormalized.label
        ? `Calling ${currentNormalized.label}...`
        : 'Processing...';

    const currentStepLabel = currentNormalized?.label ?? '';
    const currentStepTypeLabel = currentNormalized ? STEP_LABELS[currentNormalized.type] ?? 'Working' : '';

    const recentSteps = normalizedSteps.slice(-RECENT_STEPS_COUNT);

    return {
      currentLabel,
      currentStepLabel,
      currentStepTypeLabel,
      stats,
      recentSteps,
      normalizedSteps,
      currentNormalized,
      iteration,
      isActive,
    };
  }, [activity]);
}
