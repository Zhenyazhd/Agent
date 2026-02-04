import { useState, useEffect, useRef, useCallback } from 'react';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { SettingsPanel } from './components/SettingsPanel';
import { McpPanel } from './components/McpPanel';
import { AgentStepsPanel } from './components/AgentStepsPanel';
import { useChat } from './hooks/useChat';
import { useAgentActivity } from './hooks/useAgentActivity';
import { healthCheck } from './api/client';
import type { Settings } from './types';
import './App.css';

const DEFAULT_SETTINGS: Settings = {
  apiUrl: 'http://localhost:3000',
  model: 'openai/gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: 'You are a helpful AI assistant. Be concise and helpful in your responses.',
  agentMode: false,
};

function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('llm-agent-settings');
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  });

  const [isConnected, setIsConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Resizable panel state
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('agent-panel-width');
    return saved ? parseInt(saved, 10) : 420;
  });
  const [isResizing, setIsResizing] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !mainContentRef.current) return;

      const containerRect = mainContentRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;

      // Clamp between 280px and 70% of container width
      const minWidth = 280;
      const maxWidth = containerRect.width * 0.7;
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

      setPanelWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        localStorage.setItem('agent-panel-width', panelWidth.toString());
      }
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, panelWidth]);

  const { messages, isLoading, error, agentActivity, sendUserMessage, stopGeneration, clearMessages, clearError } = useChat({
    settings,
    streaming: !settings.agentMode,
  });
  const agentView = useAgentActivity(agentActivity);

  useEffect(() => {
    localStorage.setItem('llm-agent-settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const checkConnection = async () => {
      const connected = await healthCheck(settings.apiUrl);
      setIsConnected(connected);
    };

    checkConnection();
    const interval = setInterval(checkConnection, 10000);
    return () => clearInterval(interval);
  }, [settings.apiUrl]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={`app ${settings.agentMode ? 'split-layout' : ''}`}>
      <header className="app-header">
        <h1>LLM Agent</h1>
        <button className="clear-button" onClick={clearMessages} disabled={messages.length === 0}>
          Clear
        </button>
      </header>

      <SettingsPanel
        settings={settings}
        onSettingsChange={setSettings}
        isConnected={isConnected}
      />

      <McpPanel apiUrl={settings.apiUrl} />

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={clearError} aria-label="Dismiss error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      )}

      <div className={`main-content ${isResizing ? 'resizing' : ''}`} ref={mainContentRef}>
        <main className="chat-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <h2>Start a conversation</h2>
              <p>Send a message to begin chatting with the AI assistant.</p>
              {!isConnected && (
                <p className="connection-warning">
                  Backend not connected. Make sure the server is running at{' '}
                  <code>{settings.apiUrl}</code>
                </p>
              )}
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} isStreaming={isLoading} />
              ))}
              {agentActivity.isActive && (
                <div className="typing-indicator-wrapper">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          <ChatInput
            onSend={sendUserMessage}
            onStop={stopGeneration}
            disabled={isLoading || !isConnected}
            isLoading={isLoading}
            placeholder={
              !isConnected
                ? 'Waiting for backend connection...'
                : agentActivity.isActive
                ? (agentView.currentNormalized?.type === 'tool_call' && agentView.currentStepLabel
                    ? `Agent working: ${agentView.currentStepLabel}`
                    : 'Agent working...')
                : isLoading
                ? 'AI is thinking...'
                : 'Type a message...'
            }
          />
        </main>

        {settings.agentMode && (
          <>
            <div
              className="panel-resizer"
              onMouseDown={handleMouseDown}
            >
              <div className="resizer-handle" />
            </div>
            <aside className="steps-panel" style={{ width: panelWidth }}>
              <AgentStepsPanel activity={agentActivity} />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
