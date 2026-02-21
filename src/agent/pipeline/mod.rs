mod executor;
mod parser;
mod passes;
mod report;
mod utils;

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, Semaphore};

use super::{Agent, AgentError, AgentResponse, AgentStep, StepType};
use executor::run_ts_pipeline;
use parser::extract_tx_params;
use passes::{pass1, pass2, pass3};
use report::append_to_report;
use utils::send_step;

pub async fn run_transaction_analysis_pipeline(
    agent: &Agent,
    user_message: &str,
    step_tx: Option<&mpsc::Sender<AgentStep>>,
) -> Result<AgentResponse, AgentError> {
    let mut steps = Vec::new();
    let workspace_dir = &agent.config().workspace_dir;

    let _devnull_rx;
    let devnull_tx;
    let effective_tx: &mpsc::Sender<AgentStep> = if let Some(tx) = step_tx {
        tx
    } else {
        let (tx, rx) = mpsc::channel(1);
        devnull_tx = tx;
        _devnull_rx = rx;
        &devnull_tx
    };

    // ── Extract tx params ──────────────────────────────────────
    let (tx_hash, chain_id) = extract_tx_params(user_message)
        .ok_or_else(|| {
            AgentError::Internal(
                "Could not extract tx hash and chain ID from message".to_string(),
            )
        })?;

    send_step(effective_tx,&mut steps, AgentStep {
        step_type: StepType::Thinking,
        content: format!("Extracted tx: {} on chain {}", tx_hash, chain_id),
        tool_name: None,
        tool_input: None,
        tool_output: None,
    }).await;

    // ── Step 1: Full TS pipeline ──────────────────────────────
    send_step(effective_tx,&mut steps, AgentStep {
        step_type: StepType::ToolCall,
        content: format!("Running pipeline: decode + resolve + bytecode + enrich for {}", tx_hash),
        tool_name: Some("pipeline".to_string()),
        tool_input: Some(format!("{} {}", tx_hash, chain_id)),
        tool_output: None,
    }).await;

    let pipeline_out = run_ts_pipeline(&tx_hash, chain_id, workspace_dir).await?;

    // ── Create report header ──────────────────────────────────
    let report_path = PathBuf::from(workspace_dir.as_str()).join(format!("{}.md", tx_hash));
    let report_header = format!(
        "# Transaction Analysis Report\n\n## Transaction Details\n\n*Hash:* {}\n*Chain:* {}\n\n",
        tx_hash, chain_id
    );
    append_to_report(&report_path, &report_header).await;

    // Load data for pass1/pass2
    let compact_traces_path = pipeline_out.tx_dir.join("compact_traces.json");
    let compact_traces_content = tokio::fs::read_to_string(&compact_traces_path)
        .await
        .unwrap_or_else(|_| "[]".to_string());
    let compact_traces_json: serde_json::Value =
        serde_json::from_str(&compact_traces_content).unwrap_or_else(|_| serde_json::json!([]));

    let mut all_traces: Vec<serde_json::Value> = Vec::new();
    for trace_path in &pipeline_out.trace_files {
        if let Ok(content) = tokio::fs::read_to_string(trace_path).await {
            if let Ok(trace) = serde_json::from_str(&content) {
                all_traces.push(trace);
            }
        }
    }
    let traces_json_str = serde_json::to_string_pretty(&all_traces).unwrap_or_else(|_| "[]".to_string());
    let loop_groups_content = tokio::fs::read_to_string(pipeline_out.tx_dir.join("loop_groups.json"))
        .await
        .unwrap_or_else(|_| "[]".to_string());

    let mut total_iterations = 0_usize;
    let sem = Arc::new(Semaphore::new(agent.config().max_parallel_llm_calls));

    // ── Pass 1: compact_analysis ‖ econ_facts ────────────────
    let (_compact_analysis, econ_facts_json) = pass1::run_pass1(
        agent,
        &pipeline_out,
        compact_traces_content.clone(),
        all_traces.clone(),
        traces_json_str.clone(),
        loop_groups_content,
        report_path.clone(),
        pipeline_out.tx_dir.clone(),
        effective_tx,
        &mut total_iterations,
        &mut steps,
    )
    .await?;

    // ── Pass 2: hypothesis ‖ source×N ‖ phase×M ‖ loop×5 ────────
    pass2::run_pass2(
        agent,
        pipeline_out,
        compact_traces_json,
        econ_facts_json,
        all_traces,
        report_path.clone(),
        effective_tx,
        sem,
        &mut total_iterations,
        &mut steps,
    )
    .await?;

    let final_report = pass3::run_pass3(agent, report_path, effective_tx, &mut total_iterations, &mut steps).await?;

    Ok(AgentResponse {
        steps,
        final_answer: final_report,
        iterations: 1 + total_iterations,
    })
}