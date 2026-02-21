use serde::{Deserialize, Deserializer, Serialize};
use crate::error::AgentError;

const DEFAULT_SYSTEM_PROMPT: &str = "\
You are a helpful AI assistant with access to MCP tools. \
Use tools when needed, explain your reasoning, and provide helpful responses.";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    #[default]
    Free,
    Pipeline,
}

impl AgentMode {
    fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "pipeline" => AgentMode::Pipeline,
            _ => AgentMode::Free,
        }
    }
}

fn deserialize_agent_mode<'de, D: Deserializer<'de>>(d: D) -> Result<AgentMode, D::Error> {
    let s = String::deserialize(d)?;
    Ok(AgentMode::from_str(&s))
}

fn default_base_url() -> String {
    "https://openrouter.ai/api/v1".to_string()
}
fn default_model() -> String {
    "anthropic/claude-3.5-sonnet".to_string()
}
fn default_host() -> String {
    "0.0.0.0".to_string()
}
fn default_port() -> u16 {
    3000
}
fn default_system_prompt() -> String {
    DEFAULT_SYSTEM_PROMPT.to_string()
}
fn default_workspace_dir() -> String {
    "./WORKSPACE".to_string()
}
fn default_max_iterations() -> usize { 50 }
fn default_max_same_tool_calls() -> usize { 5 }
fn default_max_total_tool_output_chars() -> usize { 2_000_000 }
fn default_max_tool_result_chars() -> usize { 100_000 }
fn default_max_history_tokens() -> usize { 150_000 }
fn default_keep_recent_turns() -> usize { 3 }
fn default_max_parallel_llm_calls() -> usize { 4 }

#[derive(Clone, Debug, Deserialize)]
pub struct Config {
    pub openrouter_api_key: String,
    #[serde(default = "default_base_url")]
    pub openrouter_base_url: String,
    #[serde(default = "default_model")]
    pub default_model: String,
    #[serde(default = "default_host")]
    pub server_host: String,
    #[serde(default = "default_port")]
    pub server_port: u16,
    #[serde(default = "default_system_prompt")]
    pub system_prompt: String,
    #[serde(default = "default_workspace_dir")]
    pub workspace_dir: String,
    #[serde(default, deserialize_with = "deserialize_agent_mode")]
    pub agent_mode: AgentMode,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: usize,
    #[serde(default = "default_max_same_tool_calls")]
    pub max_same_tool_calls: usize,
    #[serde(default)]
    pub max_total_tokens: Option<u32>,
    #[serde(default)]
    pub compact_threshold_tokens: Option<u32>,
    #[serde(default = "default_max_total_tool_output_chars")]
    pub max_total_tool_output_chars: usize,
    #[serde(default = "default_max_tool_result_chars")]
    pub max_tool_result_chars: usize,
    #[serde(default = "default_max_history_tokens")]
    pub max_history_tokens: usize,
    #[serde(default = "default_keep_recent_turns")]
    pub keep_recent_turns: usize,
    #[serde(default = "default_max_parallel_llm_calls")]
    pub max_parallel_llm_calls: usize,
}

impl Config {
    pub fn from_env() -> Result<Self, AgentError> {
        Ok(envy::from_env()?)
    }
}
