import { useState } from 'react';
import type { Settings } from '../types';
import './SettingsPanel.css';

interface SettingsPanelProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  isConnected: boolean;
}

const POPULAR_MODELS = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (cheap)' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku (cheap)' },
  { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5 (cheap)' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
];

export function SettingsPanel({ settings, onSettingsChange, isConnected }: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = (key: keyof Settings, value: string | number | boolean) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div className="settings-panel">
      <button
        className="settings-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="Settings"
      >
        <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`} />
        ⚙️ Settings
        {settings.agentMode && <span className="agent-badge">Agent Mode</span>}
        <span className={`toggle-arrow ${isOpen ? 'open' : ''}`}>▼</span>
      </button>

      {isOpen && (
        <div className="settings-content">
          {/* Agent Mode Toggle */}
          <div className="settings-group agent-mode-group">
            <label className="toggle-label">
              <span className="toggle-text">
                <strong>🤖 Agent Mode</strong>
                <span className="toggle-description">Enable tools (calculator, search, etc.)</span>
              </span>
              <div className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.agentMode}
                  onChange={(e) => handleChange('agentMode', e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </div>
            </label>
          </div>

          <div className="settings-group">
            <label htmlFor="apiUrl">API URL</label>
            <input
              id="apiUrl"
              type="text"
              value={settings.apiUrl}
              onChange={(e) => handleChange('apiUrl', e.target.value)}
              placeholder="http://localhost:3000"
            />
          </div>

          <div className="settings-group">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={settings.model}
              onChange={(e) => handleChange('model', e.target.value)}
            >
              {POPULAR_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-group">
            <label htmlFor="temperature">
              Temperature: {settings.temperature.toFixed(1)}
            </label>
            <input
              id="temperature"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings.temperature}
              onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
            />
            <div className="range-labels">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          <div className="settings-group">
            <label htmlFor="maxTokens">Max Tokens: {settings.maxTokens}</label>
            <input
              id="maxTokens"
              type="range"
              min="256"
              max="4096"
              step="256"
              value={settings.maxTokens}
              onChange={(e) => handleChange('maxTokens', parseInt(e.target.value))}
            />
          </div>

          <div className="settings-group">
            <label htmlFor="systemPrompt">System Prompt</label>
            <textarea
              id="systemPrompt"
              value={settings.systemPrompt}
              onChange={(e) => handleChange('systemPrompt', e.target.value)}
              placeholder="You are a helpful AI assistant..."
              rows={3}
            />
          </div>
        </div>
      )}
    </div>
  );
}
