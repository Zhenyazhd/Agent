use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct JsonRpcRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

impl JsonRpcRequest {
    pub fn new(id: u64, method: &str, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct JsonRpcResponse {
    #[allow(dead_code)]
    pub jsonrpc: String,
    #[allow(dead_code)]
    pub id: Option<u64>,
    pub result: Option<Value>,
    pub error: Option<JsonRpcError>,
}

impl JsonRpcResponse {
    pub fn into_result(self) -> Result<Value> {
        if let Some(error) = self.error {
            anyhow::bail!("JSON-RPC error: {} (code: {})", error.message, error.code);
        }
        self.result.context("No result in response")
    }
}

#[derive(Debug, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
}

pub fn parse_sse_response(body: &str) -> String {
    body.lines()
        .filter(|line| line.starts_with("data:"))
        .filter_map(|line| line.strip_prefix("data:").map(|s| s.trim()))
        .filter(|s| !s.is_empty())
        .last()
        .unwrap_or(body)
        .to_string()
}

pub const MCP_PROTOCOL_VERSION: &str = "2025-11-25";

pub fn create_init_params() -> Value {
    serde_json::json!({
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "capabilities": {
            "roots": { "listChanged": true },
            "sampling": {}
        },
        "clientInfo": {
            "name": "llm-agent",
            "version": "0.1.0"
        }
    })
}
