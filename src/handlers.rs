use axum::{
    extract::State,
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    Json,
};
use futures::stream::Stream;
use std::convert::Infallible;
use std::sync::Arc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;
use tracing::info;
use uuid::Uuid;

use crate::agent::Agent;
use crate::config::Config;
use crate::error::AgentError;
use crate::models::{AgentRequest, AgentResponse, Message, UsageInfo};
use crate::openrouter::OpenRouterClient;

/// Shared application state
pub struct AppState {
    pub client: OpenRouterClient,
    pub agent: Agent,
}

impl AppState {
    pub fn new(config: Config) -> Arc<Self> {
        Arc::new(Self {
            client: OpenRouterClient::new(config.clone()),
            agent: Agent::new(config),
        })
    }
}

/// Health check endpoint
pub async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "llm-agent",
        "capabilities": ["chat", "agent", "tools"]
    }))
}

/// Chat completion endpoint (non-streaming)
pub async fn chat_completion(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AgentRequest>,
) -> Result<Json<AgentResponse>, AgentError> {
    info!("Received chat completion request");

    let mut messages = request.messages;

    if let Some(system_prompt) = request.system_prompt {
        messages.insert(0, Message::system(system_prompt));
    }

    let response = state
        .client
        .chat_completion(
            messages,
            request.model,
            request.temperature,
            request.max_tokens,
        )
        .await?;

    let choice = response
        .choices
        .first()
        .ok_or_else(|| AgentError::ParseError("No choices in response".to_string()))?;

    let content = choice.message.content.clone().unwrap_or_default();

    let usage = response.usage.map(|u| UsageInfo {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
    });

    Ok(Json(AgentResponse {
        id: response.id,
        content,
        model: response.model,
        usage,
        finish_reason: choice.finish_reason.clone(),
    }))
}

/// Streaming chat completion endpoint
pub async fn chat_completion_stream(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AgentRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AgentError> {
    info!("Received streaming chat completion request");

    let mut messages = request.messages;

    if let Some(system_prompt) = request.system_prompt {
        messages.insert(0, Message::system(system_prompt));
    }

    let rx = state
        .client
        .chat_completion_stream(
            messages,
            request.model,
            request.temperature,
            request.max_tokens,
        )
        .await?;

    let stream = ReceiverStream::new(rx).map(|result| {
        let event = match result {
            Ok(chunk) => {
                let content = chunk
                    .choices
                    .first()
                    .and_then(|c| c.delta.content.clone())
                    .unwrap_or_default();

                Event::default().data(
                    serde_json::json!({
                        "id": chunk.id,
                        "content": content,
                        "finish_reason": chunk.choices.first().and_then(|c| c.finish_reason.clone()),
                    })
                    .to_string(),
                )
            }
            Err(e) => Event::default()
                .event("error")
                .data(serde_json::json!({ "error": e.to_string() }).to_string()),
        };
        Ok::<_, Infallible>(event)
    });

    Ok(Sse::new(stream))
}

/// List available models
pub async fn list_models(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, AgentError> {
    info!("Listing available models");
    let models = state.client.list_models().await?;
    Ok(Json(models))
}

/// Get available tools
pub async fn get_tools(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let tools = state.agent.get_tools();
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

/// Simple agent chat endpoint (no tools)
pub async fn agent_chat(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AgentChatRequest>,
) -> Result<Json<AgentChatResponse>, AgentError> {
    info!("Received agent chat request");

    let system_prompt = request.system_prompt.unwrap_or_else(|| {
        "You are a helpful AI assistant. Be concise and helpful in your responses.".to_string()
    });

    let mut messages = vec![Message::system(&system_prompt)];
    messages.extend(request.conversation);
    messages.push(Message::user(&request.message));

    let response = state
        .client
        .chat_completion(messages, request.model, request.temperature, request.max_tokens)
        .await?;

    let choice = response
        .choices
        .first()
        .ok_or_else(|| AgentError::ParseError("No choices in response".to_string()))?;

    let assistant_message = choice.message.content.clone().unwrap_or_default();

    Ok(Json(AgentChatResponse {
        id: Uuid::new_v4().to_string(),
        message: assistant_message,
        model: response.model,
        usage: response.usage.map(|u| UsageInfo {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
        }),
        steps: None,
    }))
}

/// Agent run endpoint with tools support
pub async fn agent_run(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AgentRunRequest>,
) -> Result<Json<AgentRunResponse>, AgentError> {
    info!("Received agent run request with tools");

    let response = state
        .agent
        .run(
            &request.message,
            request.conversation,
            request.system_prompt,
            request.model,
        )
        .await?;

    Ok(Json(AgentRunResponse {
        id: Uuid::new_v4().to_string(),
        final_answer: response.final_answer,
        steps: response.steps,
        iterations: response.iterations,
    }))
}

#[derive(Debug, serde::Deserialize)]
pub struct AgentChatRequest {
    pub message: String,
    #[serde(default)]
    pub conversation: Vec<Message>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, serde::Serialize)]
pub struct AgentChatResponse {
    pub id: String,
    pub message: String,
    pub model: String,
    pub usage: Option<UsageInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<crate::agent::AgentStep>>,
}

#[derive(Debug, serde::Deserialize)]
pub struct AgentRunRequest {
    pub message: String,
    #[serde(default)]
    pub conversation: Vec<Message>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct AgentRunResponse {
    pub id: String,
    pub final_answer: String,
    pub steps: Vec<crate::agent::AgentStep>,
    pub iterations: usize,
}
