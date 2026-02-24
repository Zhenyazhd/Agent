pub(crate) mod free;
mod history;
mod pipeline;
pub mod prompts;
mod token_budget;
mod tools;

pub(crate) use free::run_free_stream;
pub(crate) use tools::{make_mcp_tool_name, split_server_tool};

use std::sync::Arc;
use serde::Serialize;
use tokio::sync::{mpsc, RwLock};
use tracing::info;
use crate::config::{AgentMode, Config};
use crate::error::AgentError;
use crate::infrastructure::openrouter::OpenRouterClient;
use crate::mcp::McpManager;
use crate::models::Message;


#[derive(Clone)]
pub struct Agent {
    client: OpenRouterClient,
    config: Config,
    mcp: Option<Arc<McpManager>>,
    agent_mode: Arc<RwLock<AgentMode>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentStep { 
    pub step_type: StepType, 
    pub content: String, 
    pub tool_name: Option<String>, 
    pub tool_input: Option<String>, 
    pub tool_output: Option<String> 
}

#[derive(Debug)]
pub struct AgentResponse { 
    pub steps: Vec<AgentStep>, 
    pub final_answer: String, 
    pub iterations: usize 
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StepType { Thinking, ToolCall, ToolResult, FinalAnswer, Error }

impl Agent {
    pub fn new(config: Config, mcp: Option<Arc<McpManager>>) -> Self {
        let initial_mode = config.agent_mode.clone();
        Self {
            client: OpenRouterClient::new(config.clone()),
            config,
            mcp,
            agent_mode: Arc::new(RwLock::new(initial_mode)),
        }
    }

    pub(crate) fn config(&self) -> &Config { &self.config }
    pub(crate) fn client(&self) -> &OpenRouterClient { &self.client }
    pub(crate) fn mcp(&self) -> Option<&Arc<McpManager>> { self.mcp.as_ref() }

    pub async fn get_mode(&self) -> AgentMode {
        self.agent_mode.read().await.clone()
    }

    pub async fn set_mode(&self, mode: AgentMode) {
        *self.agent_mode.write().await = mode;
    }

    pub async fn run(
        &self,
        user_message: &str,
        conversation_history: Vec<Message>,
        system_prompt: Option<String>,
        model: Option<String>,
    ) -> Result<AgentResponse, AgentError> {
        let use_pipeline = *self.agent_mode.read().await == AgentMode::Pipeline;
        if use_pipeline {
            info!("[Pipeline] Transaction analysis requested, using pipeline mode");
            pipeline::run_transaction_analysis_pipeline(self, user_message, None).await
        } else {
            free::run_free(self, user_message, conversation_history, system_prompt, model).await
        }
    }

    pub async fn run_stream(
        &self,
        user_message: &str,
        conversation_history: Vec<Message>,
        system_prompt: Option<String>,
        model: Option<String>,
        step_tx: mpsc::Sender<AgentStep>,
    ) -> Result<AgentResponse, AgentError> {
        let use_pipeline = *self.agent_mode.read().await == AgentMode::Pipeline;
        if use_pipeline {
            info!("[Pipeline] Transaction analysis requested, using pipeline mode (streaming)");
            pipeline::run_transaction_analysis_pipeline(self, user_message, Some(&step_tx)).await
        } else {
            free::run_free_stream(
                self,
                user_message,
                conversation_history,
                system_prompt,
                model,
                step_tx,
            )
            .await
        }
    }
}