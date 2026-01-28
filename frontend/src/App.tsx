import { useState, useEffect, useRef } from 'react';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { SettingsPanel } from './components/SettingsPanel';
import { useChat } from './hooks/useChat';
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

  const { messages, isLoading, error, sendUserMessage, clearMessages, clearError } = useChat({
    settings,
    streaming: !settings.agentMode, // Disable streaming in agent mode
  });

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('llm-agent-settings', JSON.stringify(settings));
  }, [settings]);

  // Check API connection
  useEffect(() => {
    const checkConnection = async () => {
      const connected = await healthCheck(settings.apiUrl);
      setIsConnected(connected);
    };

    checkConnection();
    const interval = setInterval(checkConnection, 10000);
    return () => clearInterval(interval);
  }, [settings.apiUrl]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>🤖 LLM Agent</h1>
        <button className="clear-button" onClick={clearMessages} disabled={messages.length === 0}>
          🗑️ Clear Chat
        </button>
      </header>

      <SettingsPanel
        settings={settings}
        onSettingsChange={setSettings}
        isConnected={isConnected}
      />

      {error && (
        <div className="error-banner">
          <span>⚠️ {error}</span>
          <button onClick={clearError}>✕</button>
        </div>
      )}

      <main className="chat-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💬</div>
            <h2>Start a conversation</h2>
            <p>Send a message to begin chatting with the AI assistant.</p>
            {!isConnected && (
              <p className="connection-warning">
                ⚠️ Backend not connected. Make sure the server is running at{' '}
                <code>{settings.apiUrl}</code>
              </p>
            )}
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      <ChatInput
        onSend={sendUserMessage}
        disabled={isLoading || !isConnected}
        placeholder={
          !isConnected
            ? 'Waiting for backend connection...'
            : isLoading
            ? 'AI is thinking...'
            : 'Type a message...'
        }
      />
    </div>
  );
}

export default App;
