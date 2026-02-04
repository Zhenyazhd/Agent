import type { AgentStep } from '../types';
import { useAgentActivity } from '../hooks/useAgentActivity';
import '../styles/AgentActivity.css';

interface AgentActivityProps {
  activity: Parameters<typeof useAgentActivity>[0];
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

export function AgentActivityIndicator({ activity }: AgentActivityProps) {
  const {
    isActive,
    iteration,
    currentNormalized,
    currentStepTypeLabel,
    currentStepLabel,
    stats,
    recentSteps,
  } = useAgentActivity(activity);

  if (!isActive) return null;

  return (
    <div className="agent-activity">
      <div className="activity-header">
        <div className="activity-spinner"></div>
        <span className="activity-title">Agent Working</span>
        {iteration > 0 && (
          <span className="activity-iteration">Iteration {iteration}</span>
        )}
      </div>

      {currentNormalized && (
        <div className={`activity-current step-${currentNormalized.type}`}>
          <span className="activity-icon">
            <StepIcon type={currentNormalized.iconType} />
          </span>
          <span className="activity-label">{currentStepTypeLabel}</span>
          {currentNormalized.type === 'tool_call' && currentStepLabel && (
            <span className="activity-tool">{currentStepLabel}</span>
          )}
        </div>
      )}

      <div className="activity-stats">
        {stats.thinkingCount > 0 && (
          <span className="stat">
            <span className="stat-value">{stats.thinkingCount}</span> thoughts
          </span>
        )}
        {stats.toolCallCount > 0 && (
          <span className="stat">
            <span className="stat-value">{stats.toolCallCount}</span> tool calls
          </span>
        )}
      </div>

      <div className="activity-feed">
        {recentSteps.map((step, index) => (
          <div
            key={step.raw.step_id ?? `feed-${step.type}-${step.raw.timestamp ?? index}`}
            className={`feed-item step-${step.type}`}
          >
            <span className="feed-icon">
              <StepIcon type={step.iconType} />
            </span>
            <span className="feed-text">{step.preview ?? step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
