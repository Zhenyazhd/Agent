use std::sync::Arc;
use axum::{
    extract::State,
    response::{IntoResponse, Json},
};
use serde_json::Value;
use crate::agent::{make_mcp_tool_name, split_server_tool};
use crate::error::AgentError;
use crate::state::AppState;


#[derive(Debug, serde::Deserialize)]
pub struct McpToolCallRequest {
    pub tool_name: String,
    #[serde(default)]
    pub arguments: Value,
}

#[derive(Debug, serde::Deserialize)]
pub struct McpServerToggleRequest {
    pub server_name: String,
}



pub async fn get_agent_tools(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let tools = state.agent.get_tools().await;
    Json(serde_json::json!({
        "tools": tools.iter().map(|t| {
            serde_json::json!({
                "name": t.function.name,
                "description": t.function.description,
                "parameters": t.function.parameters
            })
        }).collect::<Vec<_>>()
    }))
}

pub async fn get_mcp_tools(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match &state.mcp {
        Some(mcp) => {
            let tools = mcp.get_all_tools().await;
            let tools_json: Vec<_> = tools
                .into_iter()
                .map(|(server, tool)| {
                    serde_json::json!({
                        "server": server,
                        "name": tool.name,
                        "full_name": make_mcp_tool_name(&server, &tool.name),
                        "description": tool.description,
                        "input_schema": tool.input_schema
                    })
                })
                .collect();

            Json(serde_json::json!({
                "mcp_enabled": true,
                "servers": mcp.connected_servers().await,
                "tools": tools_json
            }))
        }
        None => {
            Json(serde_json::json!({
                "mcp_enabled": false,
                "servers": [],
                "tools": []
            }))
        }
    }
}

pub async fn mcp_call_tool(
    State(state): State<Arc<AppState>>,
    Json(request): Json<McpToolCallRequest>,
) -> Result<Json<serde_json::Value>, AgentError> {
    let mcp = state.require_mcp()?;

    let name = request.tool_name.strip_prefix("mcp_").unwrap_or(&request.tool_name);
    let (server, tool) = split_server_tool(name)
        .ok_or_else(|| AgentError::Internal(format!("Invalid tool name: {}", request.tool_name)))?;

    let result = mcp
        .call_tool(server, tool, request.arguments)
        .await
        .map_err(|e| AgentError::Internal(format!("MCP tool call failed: {}", e)))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "result": result
    })))
}

pub async fn get_mcp_servers(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    if let Some(ref mcp) = state.mcp {
        let servers = mcp.get_servers_status().await;
        Json(serde_json::json!({
            "mcp_enabled": true,
            "servers": servers
        }))
    } else {
        Json(serde_json::json!({
            "mcp_enabled": false,
            "servers": []
        }))
    }
}

pub async fn enable_mcp_server(
    State(state): State<Arc<AppState>>,
    Json(request): Json<McpServerToggleRequest>,
) -> Result<Json<serde_json::Value>, AgentError> {
    let mcp = state.require_mcp()?;

    mcp.enable_server(&request.server_name)
        .await
        .map_err(|e| AgentError::Internal(format!("Failed to enable server: {}", e)))?;

    let servers = mcp.get_servers_status().await;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Server {} enabled", request.server_name),
        "servers": servers
    })))
}

pub async fn disable_mcp_server(
    State(state): State<Arc<AppState>>,
    Json(request): Json<McpServerToggleRequest>,
) -> Result<Json<serde_json::Value>, AgentError> {
    let mcp = state.require_mcp()?;

    mcp.disable_server(&request.server_name)
        .await
        .map_err(|e| AgentError::Internal(format!("Failed to disable server: {}", e)))?;

    let servers = mcp.get_servers_status().await;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Server {} disabled", request.server_name),
        "servers": servers
    })))
}
