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
    RequestFailed(#[from] reqwest::Error),

    #[error("API error (status {status}): {message}")]
    ApiError { status: u16, message: String },

    #[error("Parse error: {0}")]
    ParseError(#[from] serde_json::Error),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Tool error: {0}")]
    ToolError(String),
}

impl From<envy::Error> for AgentError {
    fn from(error: envy::Error) -> Self {
        AgentError::ConfigError(error.to_string())
    }
}

impl From<anyhow::Error> for AgentError {
    fn from(error: anyhow::Error) -> Self {
        AgentError::Internal(error.to_string())
    }
}

impl From<std::io::Error> for AgentError {
    fn from(error: std::io::Error) -> Self {
        AgentError::ToolError(error.to_string())
    }
}

impl From<regex::Error> for AgentError {
    fn from(error: regex::Error) -> Self {
        AgentError::ConfigError(error.to_string())
    }
}

impl AgentError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            AgentError::ConfigError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AgentError::RequestFailed(_) => StatusCode::BAD_GATEWAY,
            AgentError::ApiError { status, .. } => {
                StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_GATEWAY)
            }
            AgentError::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_code(&self) -> &'static str {
        match self {
            AgentError::ConfigError(_) => "CONFIG_ERROR",
            AgentError::RequestFailed(_) => "REQUEST_FAILED",
            AgentError::ApiError { .. } => "API_ERROR",
            AgentError::ParseError(_) => "PARSE_ERROR",
            AgentError::InvalidRequest(_) => "INVALID_REQUEST",
            AgentError::Internal(_) => "INTERNAL_ERROR",
            AgentError::ToolError(_) => "TOOL_ERROR",
        }
    }
}

impl IntoResponse for AgentError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let code = self.error_code();
        let message = self.to_string();

        let body = Json(json!({
            "error": message,
            "code": code,
        }));

        (status, body).into_response()
    }
}
