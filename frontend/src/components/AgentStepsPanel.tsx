import { useEffect, useRef } from 'react';
import type { NormalizedStep } from '../types';
import { useAgentActivity } from '../hooks/useAgentActivity';
import '../styles/AgentStepsPanel.css';

interface AgentStepsPanelProps {
  activity: Parameters<typeof useAgentActivity>[0];
}

function StepIcon({ type }: { type: string }) {
  switch (type) {
    case 'thinking':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case 'tool_call':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case 'tool_result':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case 'error':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case 'final_answer':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    default:
      return null;
  }
}

function StepCard({ step, index }: { step: NormalizedStep; index: number }) {
  const { type, label, iconType, isMeta, details, raw } = step;

  if (isMeta) {
    return (
      <div className={`step-card step-${type} step-iteration`}>
        <div className="step-header">
          <span className="step-number">#{index + 1}</span>
          <span className="step-icon">
            <StepIcon type={iconType} />
          </span>
          <span className="step-label">{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`step-card step-${type}`}>
      <div className="step-header">
        <span className="step-number">#{index + 1}</span>
        <span className="step-icon">
          <StepIcon type={iconType} />
        </span>
        <span className="step-label">{label}</span>
      </div>

      {type === 'tool_call' && raw.tool_input && (
        <div className="step-content">
          <details>
            <summary>Input</summary>
            <pre>{(() => {
              try {
                return JSON.stringify(JSON.parse(raw.tool_input!), null, 2);
              } catch {
                return raw.tool_input;
              }
            })()}</pre>
          </details>
        </div>
      )}

      {type === 'tool_result' && details && (
        <div className="step-content">
          <details>
            <summary>Result</summary>
            <pre>{details.length > 2000 ? details.slice(0, 2000) + '...' : details}</pre>
          </details>
        </div>
      )}

      {type === 'thinking' && details && (
        <div className="step-content thinking-content">
          <p>{details}</p>
        </div>
      )}

      {type === 'error' && details && (
        <div className="step-content error-content">
          <p>{details}</p>
        </div>
      )}

      {type === 'final_answer' && details && (
        <div className="step-content final-content">
          <p>{details.length > 500 ? details.slice(0, 500) + '...' : details}</p>
        </div>
      )}
    </div>
  );
}

export function AgentStepsPanel({ activity }: AgentStepsPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { normalizedSteps, currentLabel, isActive } = useAgentActivity(activity);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [normalizedSteps]);

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
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
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
