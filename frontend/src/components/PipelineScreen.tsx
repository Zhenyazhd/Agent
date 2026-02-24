import { useState, useCallback } from 'react';
import { Play, X, Square } from 'lucide-react';
import type { AgentActivity } from '../types';
import '../styles/PipelineScreen.css';

interface PipelineScreenProps {
  isConnected: boolean;
  isRunning: boolean;
  agentActivity: AgentActivity;
  finalAnswer: string;
  error: string | null;
  onRun: (chainId: string, txHashes: string[]) => void;
  onStop: () => void;
  onReset: () => void;
}

const isValidChainId = (v: string) => /^\d+$/.test(v.trim());
const isValidHash = (h: string) => /^0x[a-fA-F0-9]{64}$/.test(h.trim());

const STEP_LABELS: Record<string, string> = {
  thinking: 'Thinking',
  tool_call: 'Running tool',
  tool_result: 'Got result',
  final_answer: 'Finalizing',
  error: 'Error',
};

export function PipelineScreen({
  isConnected,
  isRunning,
  agentActivity,
  finalAnswer,
  error,
  onRun,
  onStop,
  onReset,
}: PipelineScreenProps) {
  const currentStep = agentActivity.currentStep;
  const [chainId, setChainId] = useState('');
  const [txHashes, setTxHashes] = useState<{ id: string; value: string }[]>([
    { id: crypto.randomUUID(), value: '' },
  ]);

  const addTxHash = useCallback(() => {
    setTxHashes((prev) => [...prev, { id: crypto.randomUUID(), value: '' }]);
  }, []);

  const removeTxHash = useCallback((id: string) => {
    setTxHashes((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const updateTxHash = useCallback((id: string, value: string) => {
    setTxHashes((prev) => prev.map((h) => (h.id === id ? { ...h, value } : h)));
  }, []);

  const handleRun = useCallback(() => {
    const hashes = txHashes.map((h) => h.value.trim()).filter(Boolean);
    onRun(chainId.trim(), hashes);
  }, [chainId, txHashes, onRun]);

  const chainIdValid = isValidChainId(chainId);
  const filledHashes = txHashes.filter((h) => h.value.trim().length > 0);
  const canRun =
    isConnected &&
    chainIdValid &&
    filledHashes.length > 0 &&
    filledHashes.every((h) => isValidHash(h.value)) &&
    !isRunning;

  const hasResult = finalAnswer || error;

  return (
    <div className="pipeline-screen">
      <div className="pipeline-form">
        <h2 className="pipeline-title">Pipeline</h2>

        <div className="pipeline-field">
          <label htmlFor="chainId" className="pipeline-label">Chain ID</label>
          <input
            id="chainId"
            type="text"
            className={`pipeline-input ${chainId.trim() && !chainIdValid ? 'pipeline-input--error' : ''}`}
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
            placeholder="e.g. 1"
            disabled={isRunning}
          />
        </div>

        <div className="pipeline-field">
          <div className="pipeline-label-row">
            <label className="pipeline-label">Transaction Hashes</label>
            <button
              type="button"
              className="pipeline-add-btn"
              onClick={addTxHash}
              disabled={isRunning}
              title="Add transaction hash"
            >
              + Add
            </button>
          </div>

          <div className="pipeline-hashes-list">
            {txHashes.map(({ id, value }, index) => (
              <div key={id} className="pipeline-hash-row">
                <span className="pipeline-hash-index">{index + 1}</span>
                <input
                  type="text"
                  className={`pipeline-input pipeline-hash-input ${value.trim() && !isValidHash(value) ? 'pipeline-input--error' : ''}`}
                  value={value}
                  onChange={(e) => updateTxHash(id, e.target.value)}
                  placeholder="0x..."
                  disabled={isRunning}
                />
                {txHashes.length > 1 && (
                  <button
                    type="button"
                    className="pipeline-remove-btn"
                    onClick={() => removeTxHash(id)}
                    disabled={isRunning}
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="pipeline-actions">
          <button
            type="button"
            className="pipeline-run-btn"
            onClick={handleRun}
            disabled={!canRun}
          >
            {isRunning ? <span className="pipeline-spinner" /> : <Play size={16} />}
            {isRunning ? 'Running...' : 'Run Pipeline'}
          </button>

          {isRunning && (
            <button type="button" className="pipeline-stop-btn" onClick={onStop}>
              <Square size={14} />
              Stop
            </button>
          )}
        </div>

        {!isConnected && (
          <p className="pipeline-warning">
            Backend not connected.
          </p>
        )}
      </div>

      {isRunning && (
        <div className="pipeline-progress">
          <div className="pipeline-progress-header">
            <span className="pipeline-progress-spinner" />
            <span className="pipeline-progress-label">
              {currentStep ? (STEP_LABELS[currentStep.step_type] ?? 'Working') : 'Starting...'}
            </span>
            {agentActivity.steps.length > 0 && (
              <span className="pipeline-progress-count">
                {agentActivity.steps.length} step{agentActivity.steps.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {currentStep && currentStep.step_type !== 'thinking' && (
            <p className="pipeline-progress-detail">
              {currentStep.tool_name
                ? currentStep.tool_name.replace(/^mcp_/, '').replace(/_/g, ' / ')
                : currentStep.content.slice(0, 120)}
            </p>
          )}
          {currentStep?.step_type === 'thinking' && currentStep.content && (
            <p className="pipeline-progress-detail">{currentStep.content.slice(0, 120)}</p>
          )}
        </div>
      )}

      {hasResult && (
        <div className="pipeline-result">
          <div className="pipeline-result-header">
            <span className={`pipeline-result-badge ${error ? 'error' : 'success'}`}>
              {error ? 'Error' : 'Done'}
            </span>
            <button type="button" className="pipeline-result-clear" onClick={onReset}>
              Clear
            </button>
          </div>

          {error && <div className="pipeline-result-error">{error}</div>}

          {finalAnswer && (
            <details className="pipeline-result-details" open>
              <summary className="pipeline-result-summary">Report</summary>
              <pre className="pipeline-result-json">{finalAnswer}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
