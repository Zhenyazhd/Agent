use std::sync::Arc;
use crate::agent::Agent;
use crate::config::Config;
use crate::error::AgentError;
use crate::infrastructure::openrouter::OpenRouterClient;
use crate::mcp::McpManager;

pub struct AppState {
    pub client: OpenRouterClient,
    pub agent: Agent,
    pub mcp: Option<Arc<McpManager>>,
}


impl AppState {
    pub fn new(config: Config, mcp: Option<Arc<McpManager>>) -> Arc<Self> {
        Arc::new(Self {
            client: OpenRouterClient::new(config.clone()),
            agent: Agent::new(config, mcp.clone()),
            mcp,
        })
    }

    pub fn require_mcp(&self) -> Result<&Arc<McpManager>, AgentError> {
        self.mcp
            .as_ref()
            .ok_or_else(|| AgentError::Internal("MCP not configured".to_string()))
    }
}
