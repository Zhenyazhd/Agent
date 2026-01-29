mod agent;   
mod config;     
mod error;     
mod handlers;    
mod mcp;         
mod models;      
mod openrouter;  

use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::handlers::{
    agent_chat, agent_run, chat_completion, chat_completion_stream, disable_mcp_server,
    enable_mcp_server, get_mcp_servers, get_mcp_tools, get_tools, health_check, list_models,
    mcp_call_tool, AppState,
};
use crate::mcp::McpManager;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "llm_agent=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    dotenvy::dotenv().ok();
    let config = Config::from_env().map_err(|e| {
        anyhow::anyhow!(
            "Failed to load configuration. Make sure OPENROUTER_API_KEY is set. Error: {}",
            e
        )
    })?;

    info!("Starting LLM Agent server");
    info!("Using model: {}", config.default_model);

    let mcp_manager = match McpManager::load_config("mcp_config.json") {
        Ok(mcp_config) => {
            info!("Loaded MCP configuration with {} servers", mcp_config.mcp_servers.len());
            let manager = McpManager::new(mcp_config);

            if let Err(e) = manager.connect_all().await {
                warn!("Some MCP servers failed to connect: {}", e);
            }

            let connected = manager.connected_servers().await;
            if !connected.is_empty() {
                info!("Connected MCP servers: {:?}", connected);
            }

            Some(Arc::new(manager))
        }
        Err(e) => {
            warn!("Failed to load MCP config (mcp_config.json): {}. MCP features disabled.", e);
            None
        }
    };

    let state = AppState::new(config.clone(), mcp_manager);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/v1/chat/completions", post(chat_completion))
        .route("/v1/chat/completions/stream", post(chat_completion_stream))
        .route("/v1/agent/chat", post(agent_chat))
        .route("/v1/agent/run", post(agent_run))
        .route("/v1/agent/tools", get(get_tools))
        .route("/v1/mcp/servers", get(get_mcp_servers))
        .route("/v1/mcp/servers/enable", post(enable_mcp_server))
        .route("/v1/mcp/servers/disable", post(disable_mcp_server))
        .route("/v1/mcp/tools", get(get_mcp_tools))
        .route("/v1/mcp/call", post(mcp_call_tool))
        .route("/v1/models", get(list_models))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.server_host, config.server_port);
    info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
