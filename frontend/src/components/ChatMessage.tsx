import type { Message } from '../types';
import { AgentSteps } from './AgentSteps';
import ReactMarkdown from 'react-markdown';
import '../styles/ChatMessage.css';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const hasSteps = message.steps && message.steps.length > 0;

  return (
    <div className={`chat-message ${isUser ? 'user' : 'assistant'} ${hasSteps ? 'has-steps' : ''}`}>
      <div className="message-avatar">
        {isUser ? 'Y' : 'A'}
      </div>
      <div className="message-content">
        <div className="message-header">
          <span className="message-role">
            {isUser ? 'You' : hasSteps ? 'Agent' : 'Assistant'}
          </span>
          <span className="message-time">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {hasSteps && (
          <AgentSteps steps={message.steps!.filter(s => s.step_type !== 'final_answer')} />
        )}

        <div className="message-text">
          {message.content ? (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          ) : (
            <span className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
