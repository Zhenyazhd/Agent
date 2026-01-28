// Модули проекта
mod agent;       // Агент с поддержкой tools
mod config;      // Конфигурация из переменных окружения
mod error;       // Обработка ошибок
mod handlers;    // HTTP обработчики для эндпоинтов
mod models;      // Модели данных (запросы/ответы)
mod openrouter;  // Клиент для работы с OpenRouter API
mod tools;       // Инструменты для агента

use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::agent::Agent;
use crate::config::Config;
use crate::handlers::{
    agent_chat, agent_run, chat_completion, chat_completion_stream, get_tools, health_check,
    list_models, AppState,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "llm_agent=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load environment variables from .env file
    dotenvy::dotenv().ok();

    // Load configuration
    let config = Config::from_env().map_err(|e| {
        anyhow::anyhow!(
            "Failed to load configuration. Make sure OPENROUTER_API_KEY is set. Error: {}",
            e
        )
    })?;

    info!("Starting LLM Agent server");
    info!("Using model: {}", config.default_model);

    // Create shared state with agent
    let state = AppState::new(config.clone());

    // Настройка CORS (Cross-Origin Resource Sharing)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build router
    let app = Router::new()
        .route("/health", get(health_check))
        // Chat endpoints
        .route("/v1/chat/completions", post(chat_completion))
        .route("/v1/chat/completions/stream", post(chat_completion_stream))
        // Simple chat endpoint (no tools)
        .route("/v1/agent/chat", post(agent_chat))
        // Agent endpoint with tools
        .route("/v1/agent/run", post(agent_run))
        // Tools
        .route("/v1/agent/tools", get(get_tools))
        // Models
        .route("/v1/models", get(list_models))
        // Add middleware
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let addr = format!("{}:{}", config.server_host, config.server_port);
    info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
