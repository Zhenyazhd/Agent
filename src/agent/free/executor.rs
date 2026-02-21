use tracing::{debug, info, warn};
use tokio::sync::mpsc;
use crate::config::Config;
use crate::error::AgentError;
use crate::models::Message;
use crate::infrastructure::openrouter::CompletionOptions;
use super::{loop_state::LoopState, step_sink::StepSink};
use super::super::{Agent, AgentResponse, AgentStep, StepType};
use super::super::history::*;
use super::super::token_budget::*;


async fn maybe_compact_by_size(
    state: &mut LoopState,
    cfg: &Config,
    sink: &mut StepSink,
) {
    let tokens = if state.budget.last_prompt_tokens > 0 {
        state.budget.last_prompt_tokens as usize
    } else {
        state.history_tokens_est
    };
    if tokens <= cfg.max_history_tokens {
        return;
    }
    warn!(
        "[TokenBudget] history ~{} tokens > {} limit, compacting (source: {})",
        tokens, cfg.max_history_tokens,
        if state.budget.last_prompt_tokens > 0 { "api" } else { "estimate" }
    );
    sink.emit_status("Compacting conversation history (size limit)...").await;
    let compacted = compact_history_simple(&state.messages, cfg.keep_recent_turns);
    state.replace_messages(compacted);
}

async fn apply_token_budget(
    state: &mut LoopState,
    prompt_tokens: u32,
    completion_tokens: u32,
    agent: &Agent,
    model: &str,
    cfg: &Config,
    sink: &mut StepSink,
) -> bool {
    if state.budget.record_usage(prompt_tokens, completion_tokens) {
        warn!(
            "[TokenBudget] prompt window full ({}/{} tokens), stopping",
            state.budget.last_prompt_tokens, state.budget.max_prompt_tokens
        );
        sink.emit(AgentStep {
            step_type: StepType::Error,
            content: format!(
                "Token budget exhausted (prompt {}/{} tokens). Stopping.",
                state.budget.last_prompt_tokens, state.budget.max_prompt_tokens
            ),
            tool_name: None, tool_input: None, tool_output: None,
        }).await;
        state.final_answer = sink.last_meaningful()
            .unwrap_or_else(|| "Task stopped: token budget exceeded.".to_string());
        state.done = true;
        return true;
    }

    if state.budget.needs_compact() {
        info!("[TokenBudget] threshold reached, compacting history with summary");
        sink.emit_status("Compacting conversation history to save context...").await;
        let compacted = compact_history_with_summary(agent, &state.messages, model, cfg.keep_recent_turns).await;
        state.replace_messages(compacted);
    }

    false
}

async fn run_free_internal(
    agent: &Agent,
    user_message: &str,
    conversation_history: Vec<Message>,
    system_prompt: Option<String>,
    model: Option<String>,
    mut sink: StepSink,
) -> Result<AgentResponse, AgentError> {
    let cfg = agent.config();
    let system_prompt = system_prompt.unwrap_or_else(|| cfg.system_prompt.clone());
    let model = model.unwrap_or_else(|| cfg.default_model.clone());

    let mut messages = Vec::with_capacity(conversation_history.len() + 2); 
    messages.push(Message::system(&system_prompt));
    messages.extend(conversation_history);
    messages.push(Message::user(user_message));

    let tools = agent.get_tools().await;
    info!("[Free Mode] Agent has {} MCP tools available", tools.len());

    let (max_total_tokens, compact_threshold) = effective_token_limits(&model, cfg);
    info!(
        "[TokenBudget] model='{}' ctx_window={} max_tokens={} compact_at={}",
        model, model_context_window(&model), max_total_tokens, compact_threshold
    );

    let budget = SessionBudget::new(max_total_tokens, compact_threshold, cfg.max_total_tool_output_chars);
    let mut state = LoopState::new(messages, cfg.max_same_tool_calls * 3, budget);
    let mut iterations = 0;

    sink.emit_status("Starting agent (Free Mode)...").await;

    while !state.done && iterations < cfg.max_iterations {
        iterations += 1;
        info!("Agent iteration {}", iterations);
        debug!("Messages: {:?}", state.messages);
        sink.emit_status(format!("Iteration {}...", iterations)).await;

        maybe_compact_by_size(&mut state, cfg, &mut sink).await;

        let response = match agent.client()
            .chat_completion(&state.messages, CompletionOptions {
                model: Some(&model),
                tools: (!tools.is_empty()).then_some(tools.as_slice()),
                ..Default::default()
            })
            .await
        {
            Ok(r) => r,
            Err(e) => {
                sink.emit(AgentStep {
                    step_type: StepType::Error,
                    content: format!("LLM request failed: {}", e),
                    tool_name: None, tool_input: None, tool_output: None,
                }).await;
                return Err(e);
            }
        };

        let should_stop = if let Some(ref usage) = response.usage {
            apply_token_budget(&mut state, usage.prompt_tokens, usage.completion_tokens, agent, &model, cfg, &mut sink).await
        } else {
            warn!("[TokenBudget] API returned no usage data, falling back to history estimate ({} tokens)", state.history_tokens_est);
            if state.budget.record_usage_fallback(state.history_tokens_est) {
                info!("[TokenBudget] fallback estimate exceeds compact threshold, compacting with summary");
                sink.emit_status("Compacting conversation history to save context...").await;
                let compacted = compact_history_with_summary(agent, &state.messages, &model, cfg.keep_recent_turns).await;
                state.replace_messages(compacted);
            }
            false
        };
        if should_stop { break; }

        let choice = match response.choices.first() {
            Some(c) => c,
            None => {
                sink.emit(AgentStep {
                    step_type: StepType::Error,
                    content: "No choices in LLM response".to_string(),
                    tool_name: None, tool_input: None, tool_output: None,
                }).await;
                return Err(AgentError::Internal("No choices in response".to_string()));
            }
        };

        let tool_calls = choice.message.tool_calls.as_deref().filter(|tc| !tc.is_empty());

        if let Some(tool_calls) = tool_calls {
            state.execute_tool_calls(agent, tool_calls, choice.message.content.clone(), cfg, &mut sink).await;
        } else {
            state.final_answer = choice.message.content.clone().unwrap_or_default();
            sink.emit(AgentStep {
                step_type: StepType::FinalAnswer,
                content: state.final_answer.clone(),
                tool_name: None, tool_input: None, tool_output: None,
            }).await;
            state.done = true;
        }
    }

    if !state.done {
        sink.emit(AgentStep {
            step_type: StepType::Error,
            content: "Maximum iterations reached".to_string(),
            tool_name: None, tool_input: None, tool_output: None,
        }).await;
        state.final_answer = sink.last_meaningful()
            .unwrap_or_else(|| "Task incomplete: iteration limit reached.".to_string());
    }

    info!(
        "[TokenBudget] session complete — prompt_window={} generated={} tool_chars={} iterations={}",
        state.budget.last_prompt_tokens, state.budget.generated_tokens,
        state.budget.total_tool_chars, iterations
    );

    Ok(AgentResponse { steps: sink.into_steps(), final_answer: state.final_answer, iterations })
}

pub(crate) async fn run_free(
    agent: &Agent,
    user_message: &str,
    conversation_history: Vec<Message>,
    system_prompt: Option<String>,
    model: Option<String>,
) -> Result<AgentResponse, AgentError> {
    let sink = StepSink::collect(agent.config().max_iterations);
    run_free_internal(agent, user_message, conversation_history, system_prompt, model, sink).await
}

pub(crate) async fn run_free_stream(
    agent: &Agent,
    user_message: &str,
    conversation_history: Vec<Message>,
    system_prompt: Option<String>,
    model: Option<String>,
    step_tx: mpsc::Sender<AgentStep>,
) -> Result<AgentResponse, AgentError> {
    let sink = StepSink::streaming(step_tx, agent.config().max_iterations);
    run_free_internal(agent, user_message, conversation_history, system_prompt, model, sink).await
}
