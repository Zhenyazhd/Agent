use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AgentError {
    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Request failed: {0}")]
    RequestFailed(String),

    #[error("API error (status {status}): {message}")]
    ApiError { status: u16, message: String },

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Stream error: {0}")]
    StreamError(String),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Tool error: {0}")]
    ToolError(String),
}

impl IntoResponse for AgentError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AgentError::ConfigError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "CONFIG_ERROR", msg.clone())
            }
            AgentError::RequestFailed(msg) => {
                (StatusCode::BAD_GATEWAY, "REQUEST_FAILED", msg.clone())
            }
            AgentError::ApiError { status, message } => {
                let status_code = StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY);
                (status_code, "API_ERROR", message.clone())
            }
            AgentError::ParseError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "PARSE_ERROR", msg.clone())
            }
            AgentError::StreamError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "STREAM_ERROR", msg.clone())
            }
            AgentError::InvalidRequest(msg) => {
                (StatusCode::BAD_REQUEST, "INVALID_REQUEST", msg.clone())
            }
            AgentError::Internal(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", msg.clone())
            }
            AgentError::ToolError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "TOOL_ERROR", msg.clone())
            }
        };

        let body = Json(json!({
            "error": message,
            "code": code,
        }));

        (status, body).into_response()
    }
}
