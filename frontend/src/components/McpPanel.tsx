import { useState, useEffect, useCallback, useRef } from 'react';
import { Monitor, ChevronDown, ChevronRight } from 'lucide-react';
import { fetchMcpServers, toggleMcpServer } from '../api/client';
import type { McpServer } from '../api/client';
import '../styles/McpPanel.css';

interface McpPanelProps {
  apiUrl: string;
}

export function McpPanel({ apiUrl }: McpPanelProps) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isOpen, setIsOpen] = useState(false);

  const pendingTogglesRef = useRef<Set<string>>(new Set());
  const toggleControllersRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    return () => toggleControllersRef.current.forEach((c) => c.abort());
  }, []);

  const loadServers = useCallback(async (signal?: AbortSignal) => {
    try {
      const fresh = await fetchMcpServers(apiUrl, signal);
      setServers((prev) =>
        fresh.map((s) =>
          pendingTogglesRef.current.has(s.name)
            ? (prev.find((p) => p.name === s.name) ?? s)
            : s
        )
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Failed to fetch MCP servers:', error);
    }
  }, [apiUrl]);

  useEffect(() => {
    const controller = new AbortController();
    loadServers(controller.signal);
    return () => controller.abort();
  }, [loadServers]);

  useEffect(() => {
    if (!isOpen) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    let currentController: AbortController | null = null;

    const poll = async () => {
      currentController = new AbortController();
      const { signal } = currentController;
      await loadServers(signal);
      if (!signal.aborted) {
        timeoutId = setTimeout(poll, 30_000);
      }
    };

    timeoutId = setTimeout(poll, 30_000);
    return () => {
      clearTimeout(timeoutId);
      currentController?.abort();
    };
  }, [isOpen, loadServers]);

  const toggleServer = async (serverName: string, enable: boolean) => {
    const controller = new AbortController();
    const { signal } = controller;
    toggleControllersRef.current.add(controller);
    pendingTogglesRef.current.add(serverName);

    const previousServers = servers;
    setServers((prev) => prev.map((s) => (s.name === serverName ? { ...s, enabled: enable } : s)));
    setLoading((prev) => ({ ...prev, [serverName]: true }));

    try {
      const updated = await toggleMcpServer(serverName, enable, apiUrl, signal);
      if (!signal.aborted) setServers(updated);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error(`Failed to ${enable ? 'enable' : 'disable'} server:`, error);
      if (!signal.aborted) setServers(previousServers);
    } finally {
      toggleControllersRef.current.delete(controller);
      if (!signal.aborted) {
        pendingTogglesRef.current.delete(serverName);
        setLoading((prev) => ({ ...prev, [serverName]: false }));
      }
    }
  };

  useEffect(() => {
    const serverNames = new Set(servers.map((s) => s.name));
    setExpanded((prev) => {
      const stale = Object.keys(prev).filter((name) => !serverNames.has(name));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      stale.forEach((name) => delete next[name]);
      return next;
    });
  }, [servers]);

  const toggleExpand = (serverName: string) => {
    setExpanded((prev) => ({ ...prev, [serverName]: !prev[serverName] }));
  };

  const enabledCount = servers.filter((s) => s.enabled).length;
  const totalToolsCount = servers
    .filter((s) => s.enabled && s.connected)
    .reduce((acc, s) => acc + s.tools_count, 0);

  return (
    <div className="mcp-panel">
      <button className="mcp-toggle" onClick={() => setIsOpen(!isOpen)}>
        <span className="mcp-icon">
          <Monitor size={16} />
        </span>
        <span>MCP Servers</span>
        <span className="mcp-badge">{enabledCount}/{servers.length}</span>
        {totalToolsCount > 0 && (
          <span className="mcp-tools-badge">{totalToolsCount} tools</span>
        )}
        <span className={`toggle-arrow ${isOpen ? 'open' : ''}`}>
          <ChevronDown size={10} />
        </span>
      </button>

      {isOpen && (
        <div className="mcp-content">
          {servers.length === 0 ? (
            <div className="mcp-empty">
              No MCP servers configured. Add servers to mcp_config.json
            </div>
          ) : (
            <div className="mcp-servers-list">
              {servers.map((server) => (
                <div
                  key={server.name}
                  className={`mcp-server ${server.enabled ? 'enabled' : 'disabled'}`}
                >
                  <div className="mcp-server-header">
                    <button
                      className="mcp-server-expand"
                      onClick={() => toggleExpand(server.name)}
                      disabled={!server.connected || server.tools_count === 0}
                    >
                      <span className={`expand-icon ${expanded[server.name] ? 'open' : ''}`}>
                        <ChevronRight size={12} />
                      </span>
                    </button>

                    <div className="mcp-server-info">
                      <span className="mcp-server-name">{server.name}</span>
                      <span className="mcp-server-meta">
                        <span className={`mcp-status ${server.connected ? 'connected' : 'disconnected'}`} />
                        <span className="mcp-transport">{server.transport_type}</span>
                        {server.connected && server.tools_count > 0 && (
                          <span className="mcp-tools-count">{server.tools_count} tools</span>
                        )}
                      </span>
                    </div>

                    <label className="mcp-switch">
                      <input
                        type="checkbox"
                        checked={server.enabled}
                        disabled={loading[server.name]}
                        onChange={() => toggleServer(server.name, !server.enabled)}
                      />
                      <span className="mcp-slider" />
                    </label>
                  </div>

                  {expanded[server.name] && server.tools.length > 0 && (
                    <div className="mcp-tools-list">
                      {server.tools.map((tool) => (
                        <span key={tool} className="mcp-tool-tag">
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
