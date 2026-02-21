pub mod agent;
pub mod mcp;

pub use crate::state::AppState;
pub use agent::{agent_run, agent_run_stream};
pub use mcp::{mcp_call_tool, get_mcp_servers, get_mcp_tools, get_agent_tools as get_tools, enable_mcp_server, disable_mcp_server};

use std::sync::Arc;
use axum::{extract::State, response::{IntoResponse, Json}};
use crate::error::AgentError;

pub async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mcp_connected = if let Some(ref mcp) = state.mcp {
        mcp.connected_servers().await
    } else {
        vec![]
    };

    Json(serde_json::json!({
        "status": "ok",
        "service": "llm-agent",
        "capabilities": ["chat", "agent", "tools", "mcp"],
        "mcp_servers": mcp_connected
    }))
}

pub async fn list_models(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, AgentError> {
    let models = state.client.list_models().await?;
    Ok(Json(models))
}
