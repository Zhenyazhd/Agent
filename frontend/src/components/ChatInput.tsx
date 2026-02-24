import { useState, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { Send, Square } from 'lucide-react';
import '../styles/ChatInput.css';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
}

export function ChatInput({ 
  onSend, 
  onStop, 
  disabled = false, 
  isLoading = false, 
  placeholder = 'Type a message...' 
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = input.trim().length > 0 && !disabled && !isLoading;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const rafId = requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    });
    return () => cancelAnimationFrame(rafId);
  }, [input]);


  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || disabled || isLoading) return;
  
    onSend(text);
    setInput('');
  }, [input, disabled, isLoading, onSend]);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();
    submit();
  };

  return (
    <form className="chat-input-form" onSubmit={handleSubmit}>
      <div className="chat-input-wrapper">
        <div className="chat-input-container">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
          />
          {isLoading && onStop ? (
            <button
              type="button"
              className="stop-button"
              onClick={onStop}
              title="Stop generation"
            >
              <Square className="stop-button-svg" />
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              disabled={!canSend}
              title="Send message"
            >
              <Send className="send-button-svg" />
            </button>
          )}
        </div>
        <div className="chat-input-hint">
          <kbd>Enter</kbd> to send · <kbd>Shift + Enter</kbd> for new line
        </div>
      </div>
    </form>
  );
}
