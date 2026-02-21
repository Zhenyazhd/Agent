use std::sync::Arc;
use std::convert::Infallible;
use axum::{extract::State, response::Json};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;
use tracing::info;
use uuid::Uuid;

use crate::error::AgentError;
use crate::state::AppState;
use crate::models::Message;

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

pub async fn agent_run(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AgentRunRequest>,
) -> Result<Json<AgentRunResponse>, AgentError> {
    info!("Received agent run request with tools");

    let response = state
        .agent
        .run(&request.message, request.conversation, request.system_prompt, request.model)
        .await?;

    Ok(Json(AgentRunResponse {
        id: Uuid::new_v4().to_string(),
        final_answer: response.final_answer,
        steps: response.steps,
        iterations: response.iterations,
    }))
}

pub async fn agent_run_stream(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AgentRunRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    info!("Received streaming agent run request");

    let (step_tx, step_rx) = mpsc::channel::<crate::agent::AgentStep>(100);
    let run_id = Uuid::new_v4().to_string();
    let run_id_clone = run_id.clone();
    let agent = state.agent.clone();

    let AgentRunRequest { message, conversation, system_prompt, model } = request;

    tokio::spawn(async move {
        let result = agent
            .run_stream(&message, conversation, system_prompt, model, step_tx.clone())
            .await;

        if let Err(e) = result {
            tracing::error!("Agent run failed: {}", e);
            let error_step = crate::agent::AgentStep {
                step_type: crate::agent::StepType::Error,
                content: format!("Agent error: {}", e),
                tool_name: None,
                tool_input: None,
                tool_output: None,
            };
            let _ = step_tx.send(error_step).await;
        }
    });

    let stream = ReceiverStream::new(step_rx).map(move |step| {
        let is_done = matches!(
            step.step_type,
            crate::agent::StepType::FinalAnswer | crate::agent::StepType::Error
        );
        let event_data = serde_json::json!({
            "id": run_id_clone,
            "step": step,
            "done": is_done,
        });
        Ok::<_, Infallible>(Event::default().data(event_data.to_string()))
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}
