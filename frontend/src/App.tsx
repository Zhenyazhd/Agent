import { useState, useEffect, useRef, useCallback } from 'react';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { SettingsPanel } from './components/SettingsPanel';
import { McpPanel } from './components/McpPanel';
import { AgentStepsPanel } from './components/AgentStepsPanel';
import { PipelineScreen } from './components/PipelineScreen';
import { useChat } from './hooks/useChat';
import { usePipeline } from './hooks/usePipeline';
import { useAgentActivity } from './hooks/useAgentActivity';
import { healthCheck, setAgentMode } from './api/client';
import { env } from './env';
import type { Settings } from './types';
import './App.css';

const CONFIG_VERSION = env.VITE_CONFIG_VERSION;

const DEFAULT_SETTINGS: Settings = {
  apiUrl: env.VITE_API_URL ?? window.location.origin,
  model: env.VITE_DEFAULT_MODEL ?? 'openai/gpt-4o-mini',
  temperature: env.VITE_DEFAULT_TEMPERATURE,
  maxTokens: env.VITE_DEFAULT_MAX_TOKENS,
  systemPrompt: env.VITE_DEFAULT_SYSTEM_PROMPT,
  mode: env.VITE_DEFAULT_MODE as Settings['mode'],
};

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem('llm-agent-settings');
    if (!saved) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(saved);
    const storedVersion = parseInt(localStorage.getItem('llm-agent-settings-version') ?? '0', 10);
    if (storedVersion !== CONFIG_VERSION) {
      const { apiUrl: _dropped, ...rest } = parsed;
      void _dropped;
      return { ...DEFAULT_SETTINGS, ...rest };
    }
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [isConnected, setIsConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('agent-panel-width');
    return saved ? parseInt(saved, 10) : 420;
  });
  const [isResizing, setIsResizing] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      const newWidth = rect.right - e.clientX;
      setPanelWidth(Math.max(280, Math.min(rect.width * 0.7, newWidth)));
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

  const { messages, isLoading, error: chatError, agentActivity: chatActivity, sendUserMessage, stopGeneration, clearMessages, clearError } = useChat({ settings });

  const pipeline = usePipeline({ settings });

  const isPipeline = settings.mode === 'pipeline';
  const activeActivity = isPipeline ? pipeline.agentActivity : chatActivity;
  const agentView = useAgentActivity(activeActivity);

  useEffect(() => {
    setAgentMode(settings.mode, settings.apiUrl).catch(console.error);
  }, [settings.mode, settings.apiUrl]);

  useEffect(() => {
    localStorage.setItem('llm-agent-settings', JSON.stringify(settings));
    localStorage.setItem('llm-agent-settings-version', String(CONFIG_VERSION));
  }, [settings]);

  useEffect(() => {
    const check = async () => setIsConnected(await healthCheck(settings.apiUrl));
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [settings.apiUrl]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const error = isPipeline ? pipeline.error : chatError;

  return (
    <div className="app">
      <header className="app-header">
        <h1>LLM Agent</h1>
        {!isPipeline && (
          <button className="clear-button" onClick={clearMessages} disabled={messages.length === 0}>
            Clear
          </button>
        )}
      </header>

      <SettingsPanel
        settings={settings}
        defaultSettings={DEFAULT_SETTINGS}
        onSettingsChange={setSettings}
        isConnected={isConnected}
      />

      <McpPanel apiUrl={settings.apiUrl} />

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={isPipeline ? pipeline.reset : clearError} aria-label="Dismiss error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className={`main-content split-layout ${isResizing ? 'resizing' : ''}`} ref={mainContentRef}>

        <div className="chat-container">
          <div style={isPipeline ? undefined : { display: 'none' }}>
            <PipelineScreen
              isConnected={isConnected}
              isRunning={pipeline.isRunning}
              agentActivity={pipeline.agentActivity}
              finalAnswer={pipeline.finalAnswer}
              error={pipeline.error}
              onRun={pipeline.run}
              onStop={pipeline.stop}
              onReset={pipeline.reset}
            />
          </div>

          <div className="mode-screen" style={isPipeline ? { display: 'none' } : undefined}>
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
                  : chatActivity.isActive
                  ? (agentView.currentNormalized?.type === 'tool_call' && agentView.currentStepLabel
                      ? `Agent working: ${agentView.currentStepLabel}`
                      : 'Agent working...')
                  : isLoading
                  ? 'AI is thinking...'
                  : 'Type a message...'
              }
            />
          </div>
        </div>

        <div className="panel-resizer" onMouseDown={handleMouseDown}>
          <div className="resizer-handle" />
        </div>
        <aside className="steps-panel" style={{ width: panelWidth }}>
          <AgentStepsPanel activity={activeActivity} />
        </aside>
      </div>
    </div>
  );
}

export default App;
