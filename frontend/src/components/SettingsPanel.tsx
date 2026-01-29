import { useState, useEffect, useCallback } from 'react';
import type { Settings, Model } from '../types';
import { fetchModels } from '../api/client';
import '../styles/SettingsPanel.css';

interface SettingsPanelProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  isConnected: boolean;
}

const POPULAR_MODELS = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku' },
  { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
];

export function SettingsPanel({ settings, onSettingsChange, isConnected }: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<Model[]>(POPULAR_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const data = await fetchModels(settings.apiUrl);
      let modelsList: Model[] = [];
      
      if (Array.isArray(data)) {
        modelsList = data;
      } else if (data.data && Array.isArray(data.data)) {
        modelsList = data.data;
      } else if (data.models && Array.isArray(data.models)) {
        modelsList = data.models;
      }
      
      const validModels = modelsList
        .filter((m: any) => m.id && m.name)
        .map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          context_length: m.context_length,
          pricing: m.pricing,
        }));
      
      if (validModels.length > 0) {
        setModels(validModels);
      } else {
        setModels(POPULAR_MODELS);
      }
    } catch (error) {
      console.error('Failed to load models, using fallback:', error);
      setModels(POPULAR_MODELS);
    } finally {
      setModelsLoading(false);
    }
  }, [settings.apiUrl]);

  useEffect(() => {
    if (isOpen) {
      loadModels();
    }
  }, [isOpen, loadModels]);

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
        Settings
        {settings.agentMode && <span className="agent-badge">Agent</span>}
        <span className={`toggle-arrow ${isOpen ? 'open' : ''}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="settings-content">
          <div className="settings-grid">
            <div className="settings-group agent-mode-group">
              <label className="toggle-label">
                <span className="toggle-text">
                  <span>Agent Mode</span>
                  <span className="toggle-description">Enable tools and multi-step reasoning</span>
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
              <label htmlFor="model">
                Model
                {modelsLoading && <span className="loading-indicator">Loading...</span>}
              </label>
              <select
                id="model"
                value={settings.model}
                onChange={(e) => handleChange('model', e.target.value)}
                disabled={modelsLoading}
              >
                {models.map((model) => (
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

            <div className="settings-group" style={{ gridColumn: '1 / -1' }}>
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
        </div>
      )}
    </div>
  );
}
