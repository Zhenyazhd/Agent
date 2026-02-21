use std::collections::VecDeque;
use tracing::warn;
use super::super::{Agent, AgentStep, StepType};
use super::step_sink::StepSink;
use super::tool_runner::run_tool;
use crate::agent::history::estimate_history_tokens;
use crate::agent::token_budget::SessionBudget;
use crate::config::Config;
use crate::models::*;


pub(super) struct LoopState {
    pub(super) messages: Vec<Message>,
    pub(super) history_tokens_est: usize,
    pub(super) budget: SessionBudget,
    recent_calls: VecDeque<(String, String)>,
    window_size: usize,
    pub(super) final_answer: String,
    pub(super) done: bool,
}

impl LoopState {
    pub(super) fn new(messages: Vec<Message>, window_size: usize, budget: SessionBudget) -> Self {
        let history_tokens_est = estimate_history_tokens(&messages);
        Self {
            messages,
            history_tokens_est,
            budget,
            recent_calls: VecDeque::with_capacity(window_size + 1),
            window_size,
            final_answer: String::new(),
            done: false,
        }
    }

    fn push_message(&mut self, msg: Message) {
        self.history_tokens_est += msg.content.as_deref().map_or(0, |c| c.chars().count() / 4);
        self.messages.push(msg);
    }

    pub(super) fn replace_messages(&mut self, new_messages: Vec<Message>) {
        self.history_tokens_est = estimate_history_tokens(&new_messages);
        self.messages = new_messages;
        self.recent_calls.clear();
    }

    fn record_tool_call(&mut self, key: (String, String)) {
        if self.recent_calls.len() >= self.window_size {
            self.recent_calls.pop_front();
        }
        self.recent_calls.push_back(key);
    }

    fn count_recent(&self, key: &(String, String)) -> usize {
        self.recent_calls.iter().filter(|k| *k == key).count()
    }

    fn check_tool_recursion(&self, name: &str, args: &str, max: usize) -> bool {
        self.count_recent(&(name.to_string(), args.to_string())) >= max
    }

    async fn handle_tool_output(
        &mut self,
        tool_id: &str,
        tool_name: &str,
        step_type: StepType,
        output: String,
        sink: &mut StepSink,
    ) -> bool {
        if self.budget.add_tool_output(output.len()) {
            warn!(
                "[TokenBudget] total tool output {} chars > {} limit, aborting",
                self.budget.total_tool_chars, self.budget.max_tool_output_chars
            );
            sink.emit(AgentStep {
                step_type: StepType::Error,
                content: format!(
                    "Tool output budget exceeded ({} chars). Stopping.",
                    self.budget.total_tool_chars
                ),
                tool_name: Some(tool_name.to_string()),
                tool_input: None, tool_output: None,
            }).await;
            self.final_answer = sink.last_meaningful()
                .unwrap_or_else(|| "Task stopped: tool output budget exceeded.".to_string());
            self.done = true;
            return true;
        }
        sink.emit(AgentStep {
            step_type,
            content: output.clone(),
            tool_name: Some(tool_name.to_string()),
            tool_input: None,
            tool_output: Some(output.clone()),
        }).await;
        self.push_message(Message::tool_result(tool_id, output));
        false
    }

    pub(super) async fn execute_tool_calls(
        &mut self,
        agent: &Agent,
        tool_calls: &[ToolCall],
        thinking_content: Option<String>,
        cfg: &Config,
        sink: &mut StepSink,
    ) {
        if let Some(ref content) = thinking_content {
            if !content.is_empty() {
                sink.emit(AgentStep {
                    step_type: StepType::Thinking,
                    content: content.clone(),
                    tool_name: None, tool_input: None, tool_output: None,
                }).await;
            }
        }
        self.push_message(Message::assistant(thinking_content).with_tool_calls(tool_calls.to_vec()));

        for tool_call in tool_calls {
            let name = &tool_call.function.name;
            let args = &tool_call.function.arguments;

            if self.check_tool_recursion(name, args, cfg.max_same_tool_calls) {
                sink.emit(AgentStep {
                    step_type: StepType::Error,
                    content: format!(
                        "Tool '{}' called {} times with identical args — aborting (hallucinated loop)",
                        name, cfg.max_same_tool_calls
                    ),
                    tool_name: Some(name.clone()),
                    tool_input: Some(args.clone()),
                    tool_output: None,
                }).await;
                self.final_answer = sink.last_meaningful()
                    .unwrap_or_else(|| "Task aborted: tool recursion detected.".to_string());
                self.done = true;
                return;
            }

            self.record_tool_call((name.clone(), args.clone()));

            sink.emit(AgentStep {
                step_type: StepType::ToolCall,
                content: format!("Calling: {}", name),
                tool_name: Some(name.clone()),
                tool_input: Some(args.clone()),
                tool_output: None,
            }).await;

            let (step_type, output) = run_tool(agent, name, args).await;

            if self.handle_tool_output(&tool_call.id, name, step_type, output, sink).await {
                return;
            }
        }
    }
}
