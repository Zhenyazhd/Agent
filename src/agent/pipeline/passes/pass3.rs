use std::path::PathBuf;
use tokio::sync::mpsc;
use tracing::info;

use crate::agent::{Agent, AgentStep, StepType};
use crate::agent::run_free_stream;
use crate::agent::pipeline::report::append_to_report;
use crate::agent::pipeline::utils::{send_step, truncate_json};
use crate::agent::prompts::{final_synthesis_prompt, FINAL_SYNTHESIS_SYSTEM};
use crate::error::AgentError;

pub async fn run_pass3(
    agent: &Agent,
    report_path: PathBuf,
    effective_tx: &mpsc::Sender<AgentStep>,
    total_iterations: &mut usize,
    steps: &mut Vec<AgentStep>,
) -> Result<String, AgentError> {
    send_step(effective_tx, steps, AgentStep {
        step_type: StepType::ToolCall,
        content: "[Pass 3/3] Synthesizing final comprehensive report".to_string(),
        tool_name: Some("final_synthesis".to_string()),
        tool_input: None, tool_output: None,
    }).await;

    let current_report = tokio::fs::read_to_string(&report_path).await.unwrap_or_default();
    let synthesis_prompt_str = final_synthesis_prompt(&truncate_json(&current_report, 80_000));

    let synthesis_result = run_free_stream(
        agent, &synthesis_prompt_str, Vec::new(),
        Some(FINAL_SYNTHESIS_SYSTEM.to_string()), None, effective_tx.clone(),
    )
    .await;

    let summary_text = match synthesis_result {
        Ok(res) => {
            *total_iterations += res.iterations;
            steps.extend(res.steps);
            res.final_answer
        }
        Err(e) => format!("## Summary\n\n*Synthesis failed: {}*", e),
    };

    append_to_report(&report_path, &format!("\n---\n\n{}\n", summary_text)).await;
    info!("Report finalized at {}", report_path.display());

    send_step(effective_tx, steps, AgentStep {
        step_type: StepType::ToolResult,
        content: format!("Report saved to {}", report_path.display()),
        tool_name: Some("summary".to_string()),
        tool_input: None, tool_output: Some(summary_text.clone()),
    }).await;

    let final_report = tokio::fs::read_to_string(&report_path)
        .await
        .unwrap_or_else(|_| summary_text.clone());

    Ok(final_report)
}   