import type { AgentStep } from '../types';
import './AgentSteps.css';

interface AgentStepsProps {
  steps: AgentStep[];
}

const stepIcons: Record<string, string> = {
  thinking: '',
  tool_call: '',
  tool_result: '',
  final_answer: '',
  error: '',
};

const stepLabels: Record<string, string> = {
  thinking: 'Thinking',
  tool_call: 'Tool Call',
  tool_result: 'Tool Result',
  final_answer: 'Answer',
  error: 'Error',
};

export function AgentSteps({ steps }: AgentStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className="agent-steps">
      {steps.map((step, index) => (
        <div key={index} className={`agent-step step-${step.step_type}`}>
          <div className="step-header">
            <span className="step-icon">{stepIcons[step.step_type] || '•'}</span>
            <span className="step-label">{stepLabels[step.step_type] || step.step_type}</span>
            {step.tool_name && (
              <span className="step-tool-name">{step.tool_name}</span>
            )}
          </div>

          {step.step_type === 'tool_call' && step.tool_input && (
            <div className="step-content tool-input">
              <div className="content-label">Input:</div>
              <pre>{formatJson(step.tool_input)}</pre>
            </div>
          )}

          {step.step_type === 'tool_result' && step.tool_output && (
            <div className="step-content tool-output">
              <div className="content-label">Output:</div>
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
