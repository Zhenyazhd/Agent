use std::collections::VecDeque;
use tokio::sync::mpsc;
use crate::agent::{AgentStep, StepType};

pub(super) struct StepSink {
    steps: VecDeque<AgentStep>,
    max_steps: usize,
    tx: Option<mpsc::Sender<AgentStep>>,
}

impl StepSink {
    pub(super) fn collect(max_steps: usize) -> Self {
        Self { steps: VecDeque::new(), max_steps, tx: None }
    }
    pub(super) fn streaming(tx: mpsc::Sender<AgentStep>, max_steps: usize) -> Self {
        Self { steps: VecDeque::new(), max_steps, tx: Some(tx) }
    }

    pub(super) async fn emit(&mut self, step: AgentStep) {
        if let Some(ref tx) = self.tx { let _ = tx.send(step.clone()).await; }
        if self.steps.len() >= self.max_steps {
            self.steps.pop_front();
        }
        self.steps.push_back(step);
    }

    pub(super) async fn emit_status(&mut self, content: impl Into<String>) {
        if let Some(ref tx) = self.tx {
            let _ = tx.send(AgentStep {
                step_type: StepType::Thinking,
                content: content.into(),
                tool_name: None, tool_input: None, tool_output: None,
            }).await;
        }
    }

    pub(super) fn last_meaningful(&self) -> Option<String> {
        self.steps.iter().rev()
            .find(|s| matches!(s.step_type, StepType::Thinking | StepType::ToolResult))
            .map(|s| s.content.clone())
    }

    pub(super) fn into_steps(self) -> Vec<AgentStep> { self.steps.into() }
}
