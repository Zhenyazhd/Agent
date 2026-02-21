use tracing::warn;
use super::super::Agent;
use super::super::StepType;
use crate::infrastructure::file_handler;

pub(super) async fn run_tool(agent: &Agent, name: &str, args: &str) -> (StepType, String) {
    let (step_type, result) = match agent.execute_tool(name, args).await {
        Ok(text) => (StepType::ToolResult, text),
        Err(e) => {
            warn!("Tool execution failed: {}", e);
            (StepType::Error, format!("Error: {}", e))
        }
    };
    let processed = file_handler::handle_large_result(&agent.config.workspace_dir, name, &result, agent.config.max_tool_result_chars).await;
    (step_type, processed)
}
