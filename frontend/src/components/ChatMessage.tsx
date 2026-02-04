import type { Message } from '../types';
import ReactMarkdown from 'react-markdown';
import '../styles/ChatMessage.css';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming = false }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const hasSteps = message.steps && message.steps.length > 0;
  const showTyping = !isUser && message.content === '' && isStreaming;

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

        <div className="message-text">
          {message.content ? (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          ) : null}
        </div>
      </div>
    </div>
  );
}
