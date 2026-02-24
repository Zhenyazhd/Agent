import { useEffect, useMemo, useRef } from 'react';
import type { NormalizedStep } from '../types';
import { useAgentActivity } from '../hooks/useAgentActivity';
import { Search } from 'lucide-react';
import {
  Clock,
  Wrench,
  CheckCircle2,
  XCircle,
  Sparkles,
} from 'lucide-react';
import type { StepType } from '../types';
import '../styles/AgentStepsPanel.css';

export const ICONS: Record<StepType, React.ElementType> = {
  thinking: Clock,
  tool_call: Wrench,
  tool_result: CheckCircle2,
  error: XCircle,
  final_answer: Sparkles,
};

interface AgentStepsPanelProps {
  activity: Parameters<typeof useAgentActivity>[0];
}

function safePrettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function StepBody({ step }: { step: NormalizedStep }) {
  const { type, details, raw } = step;

  const toolInputPretty = useMemo(() => {
    if (type !== 'tool_call' || !raw.tool_input) return null;
    return safePrettyJson(raw.tool_input);
  }, [type, raw.tool_input]);

  if (type === 'tool_call' && toolInputPretty) {
    return (
      <div className="step-content">
        <details>
          <summary>Input</summary>
          <pre>{toolInputPretty}</pre>
        </details>
      </div>
    );
  }

  if (type === 'tool_result' && details) {
    return (
      <div className="step-content">
        <details>
          <summary>Result</summary>
          <pre>{truncate(details, 2000)}</pre>
        </details>
      </div>
    );
  }

  if (type === 'thinking' && details) {
    return (
      <div className="step-content thinking-content">
        <p>{details}</p>
      </div>
    );
  }

  if (type === 'error' && details) {
    return (
      <div className="step-content error-content">
        <p>{details}</p>
      </div>
    );
  }

  if (type === 'final_answer' && details) {
    return (
      <div className="step-content final-content">
        <p>{truncate(details, 500)}</p>
      </div>
    );
  }

  return null;
}

function StepCard({ step, index }: { step: NormalizedStep; index: number }) {
  const { type, label, isMeta } = step;
  const Icon = ICONS[type];

  return (
    <div className={`step-card step-${type}${isMeta ? 'step-iteration' : ''}`}>
      <div className="step-header">
        <span className="step-number">#{index + 1}</span>
        <span className="step-icon">
          <Icon className="step-icon-svg" />
        </span>
        <span className="step-label">{label}</span>
      </div>      
        {!isMeta &&  <StepBody step={step} />}
      </div>
  );
}

export function AgentStepsPanel({ activity }: AgentStepsPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  const { normalizedSteps, currentLabel, isActive } = useAgentActivity(activity);

  useEffect(() => {
    const len = normalizedSteps.length;
    if (len > prevLenRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevLenRef.current = len;
  }, [normalizedSteps.length]);

  const isEmpty = normalizedSteps.length === 0 && !isActive;

  return (
    <div className="agent-steps-panel">
      <div className="panel-header">
        <h2>Agent Activity</h2>
        {isActive && (
          <span className="activity-badge">
            <span className="pulse"></span>
            Working
          </span>
        )}
      </div>

      <div className="steps-container">
        {isEmpty ? (
          <div className="empty-steps">
            <Search className="empty-icon-svg" />
            <p>Agent steps will appear here</p>
            <span>Enable Agent Mode to see tool calls and reasoning</span>
          </div>
        ) : (
          <>
            {normalizedSteps.map((step, index) => (
              <StepCard
                key={step.raw.step_id ?? `step-${step.type}-${step.raw.timestamp ?? index}`}
                step={step}
                index={index}
              />
            ))}

            {isActive && (
              <div className="current-step-indicator">
                <div className="spinner"></div>
                <span>{currentLabel}</span>
              </div>
            )}

            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}
