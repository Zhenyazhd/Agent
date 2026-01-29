import { useState, useEffect, useCallback } from 'react';
import '../styles/McpPanel.css';

interface McpServer {
  name: string;
  enabled: boolean;
  connected: boolean;
  transport_type: string;
  tools_count: number;
  tools: string[];
}

interface McpPanelProps {
  apiUrl: string;
}

export function McpPanel({ apiUrl }: McpPanelProps) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isOpen, setIsOpen] = useState(false);

  const fetchServers = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/v1/mcp/servers`);
      const data = await response.json();
      if (data.mcp_enabled) {
        setServers(data.servers);
      }
    } catch (error) {
      console.error('Failed to fetch MCP servers:', error);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchServers();
    const interval = setInterval(fetchServers, 30000);
    return () => clearInterval(interval);
  }, [fetchServers]);

  const toggleServer = async (serverName: string, enable: boolean) => {
    const previousServers = servers;
    
    setServers((prev) =>
      prev.map((server) =>
        server.name === serverName ? { ...server, enabled: enable } : server
      )
    );
    setLoading((prev) => ({ ...prev, [serverName]: true }));

    try {
      const endpoint = enable ? 'enable' : 'disable';
      const response = await fetch(`${apiUrl}/v1/mcp/servers/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_name: serverName }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      if (data.servers) {
        setServers(data.servers);
      }
    } catch (error) {
      console.error(`Failed to ${enable ? 'enable' : 'disable'} server:`, error);
      setServers(previousServers);
    } finally {
      setLoading((prev) => ({ ...prev, [serverName]: false }));
    }
  };

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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8" />
            <path d="M12 17v4" />
          </svg>
        </span>
        <span>MCP Servers</span>
        <span className="mcp-badge">{enabledCount}/{servers.length}</span>
        {totalToolsCount > 0 && (
          <span className="mcp-tools-badge">{totalToolsCount} tools</span>
        )}
        <span className={`toggle-arrow ${isOpen ? 'open' : ''}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
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
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
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
