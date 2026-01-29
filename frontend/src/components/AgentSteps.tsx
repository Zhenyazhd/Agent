import type { AgentStep, StepType } from '../types';
import '../styles/AgentSteps.css';

interface AgentStepsProps {
  steps: AgentStep[];
}

const StepIcon = ({ type }: { type: AgentStep['step_type'] }) => {
  switch (type) {
    case 'thinking':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 6v6l4 2"></path>
        </svg>
      );
    case 'tool_call':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
      );
    case 'tool_result':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      );
    case 'final_answer':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      );
    case 'error':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4"></circle>
        </svg>
      );
  }
};

const stepLabels: Record<StepType, string> = {
  thinking: 'Thinking',
  tool_call: 'Tool Call',
  tool_result: 'Result',
  final_answer: 'Answer',
  error: 'Error',
};

export function AgentSteps({ steps }: AgentStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className="agent-steps">
      {steps.map((step, index) => (
        <div
          key={step.step_id ?? `${step.step_type}-${index}`}
          className={`agent-step step-${step.step_type}`}
        >
          <div className="step-header">
            <span className="step-icon">
              <StepIcon type={step.step_type} />
            </span>
            <span className="step-label">{stepLabels[step.step_type]}</span>
            {step.tool_name && (
              <span className="step-tool-name">{step.tool_name}</span>
            )}
          </div>

          {step.step_type === 'tool_call' && step.tool_input && (
            <div className="step-content tool-input">
              <div className="content-label">Input</div>
              <pre>{formatJson(step.tool_input)}</pre>
            </div>
          )}

          {step.step_type === 'tool_result' && step.tool_output && (
            <div className="step-content tool-output">
              <div className="content-label">Output</div>
              <pre>{step.tool_output}</pre>
            </div>
          )}

          {(step.step_type === 'thinking' || step.step_type === 'error') && step.content && (
            <div className="step-content">
              {step.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
