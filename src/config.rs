use serde::{Deserialize, Serialize};
use std::env;

const DEFAULT_SYSTEM_PROMPT: &str = "\
You are a helpful AI assistant with access to MCP tools. \
Use tools when needed, explain your reasoning, and provide helpful responses.";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {

    #[default]
    Free,
}

impl AgentMode {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            _ => AgentMode::Free,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub openrouter_api_key: String,
    pub openrouter_base_url: String,
    pub default_model: String,
    pub server_host: String,
    pub server_port: u16,
    pub system_prompt: String,
    pub workspace_dir: String,
    pub agent_mode: AgentMode,
}

impl Config {
    pub fn from_env() -> Result<Self, env::VarError> {
        Ok(Self {
            openrouter_api_key: env::var("OPENROUTER_API_KEY")?,
            openrouter_base_url: env::var("OPENROUTER_BASE_URL")
                .unwrap_or_else(|_| "https://openrouter.ai/api/v1".to_string()),
            default_model: env::var("DEFAULT_MODEL")
                .unwrap_or_else(|_| "anthropic/claude-3.5-sonnet".to_string()),
            server_host: env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            server_port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "3000".to_string())
                .parse()
                .unwrap_or(3000),
            system_prompt: env::var("SYSTEM_PROMPT")
                .unwrap_or_else(|_| DEFAULT_SYSTEM_PROMPT.to_string()),
            workspace_dir: env::var("WORKSPACE_DIR")
                .unwrap_or_else(|_| "./WORKSPACE".to_string()),
            agent_mode: env::var("AGENT_MODE")
                .map(|s| AgentMode::from_str(&s))
                .unwrap_or_default(),
        })
    }
}
