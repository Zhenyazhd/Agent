import type { Message } from '../types';
import { AgentSteps } from './AgentSteps';
import './ChatMessage.css';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const hasSteps = message.steps && message.steps.length > 0;

  return (
    <div className={`chat-message ${isUser ? 'user' : 'assistant'} ${hasSteps ? 'has-steps' : ''}`}>
      <div className="message-avatar">
        {isUser ? '👤' : hasSteps ? '🤖' : '💬'}
      </div>
      <div className="message-content">
        <div className="message-role">
          {isUser ? 'You' : hasSteps ? 'Agent' : 'Assistant'}
        </div>

        {hasSteps && (
          <AgentSteps steps={message.steps!.filter(s => s.step_type !== 'final_answer')} />
        )}

        <div className="message-text">
          {message.content || (
            <span className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </span>
          )}
        </div>
        <div className="message-time">
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
