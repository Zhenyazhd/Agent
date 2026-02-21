use std::path::PathBuf;
use tokio::sync::mpsc;

use crate::agent::{Agent, AgentStep, StepType};
use crate::agent::{run_free_stream};
use crate::agent::pipeline::executor::PipelineOutput;
use crate::agent::pipeline::report::append_to_report;
use crate::agent::pipeline::utils::{parse_econ_facts_json, send_step, truncate_json};
use crate::agent::prompts::{
    compact_analysis_prompt, econ_facts_prompt, COMPACT_ANALYSIS_SYSTEM, ECON_FACTS_SYSTEM,
};
use crate::error::AgentError;

pub async fn run_pass1(
    agent: &Agent,
    pipeline_out: &PipelineOutput,
    compact_traces_content: String,
    all_traces: Vec<serde_json::Value>,
    traces_json_str: String,
    loop_groups_content: String,
    report_path: PathBuf,
    tx_dir: PathBuf,
    effective_tx: &mpsc::Sender<AgentStep>,
    total_iterations: &mut usize,
    steps: &mut Vec<AgentStep>,
) -> Result<(String, serde_json::Value), AgentError> {
    send_step(effective_tx, steps, AgentStep {
        step_type: StepType::ToolCall,
        content: "[Pass 1/3] compact_analysis ‖ econ_facts starting in parallel".to_string(),
        tool_name: Some("pass1".to_string()),
        tool_input: None,
        tool_output: None,
    })
    .await;

    let loop_groups_info = if !loop_groups_content.is_empty() && loop_groups_content != "[]" {
        format!("\n\nLoop groups identified:\n```json\n{}\n```", truncate_json(&loop_groups_content, 10_000))
    } else {
        String::new()
    };

    let compact_prompt = compact_analysis_prompt(
        pipeline_out.trace_doc_count as usize,
        &truncate_json(&compact_traces_content, 50_000),
        &pipeline_out.address_files,
    );
    let econ_facts_prompt_str = econ_facts_prompt(
        all_traces.len(),
        &truncate_json(&traces_json_str, 100_000),
        &loop_groups_info,
    );

    let (compact_result, econ_result) = tokio::join!(
        run_free_stream(
            agent,
            &compact_prompt,
            Vec::new(),
            Some(COMPACT_ANALYSIS_SYSTEM.to_string()),
            None,
            effective_tx.clone(),
        ),
        run_free_stream(
            agent,
            &econ_facts_prompt_str,
            Vec::new(),
            Some(ECON_FACTS_SYSTEM.to_string()),
            None,
            effective_tx.clone(),
        ),
    );

    let compact_analysis = match compact_result {
        Ok(res) => {
            *total_iterations += res.iterations;
            steps.extend(res.steps);
            res.final_answer
        }
        Err(e) => {
            tracing::warn!("Compact analysis failed: {}", e);
            format!("## Transaction Overview\n\n*Analysis failed: {}*", e)
        }
    };
    let econ_facts_text = match econ_result {
        Ok(res) => {
            *total_iterations += res.iterations;
            steps.extend(res.steps);
            res.final_answer
        }
        Err(e) => {
            tracing::warn!("Economic facts extraction failed: {}", e);
            serde_json::json!({"error": e.to_string(), "per_iteration": [], "price_quotes": [],
                "buys": [], "sells": [], "mints": [], "burns": [], "eth_transfers": [],
                "total_supply_reads": [], "suspicious_equalities": []}).to_string()
        }
    };

    let econ_facts_json: serde_json::Value = parse_econ_facts_json(&econ_facts_text);


    append_to_report(&report_path, &format!("{}\n\n---\n\n", compact_analysis)).await;
    append_to_report(&report_path, "## Economic Facts Sheet\n\n").await;
    append_to_report(&report_path, &format!("```json\n{}\n```\n\n",
        serde_json::to_string_pretty(&econ_facts_json).unwrap_or_default())).await;

    let econ_facts_path = tx_dir.join("econ_facts.json");
    tokio::fs::write(&econ_facts_path, serde_json::to_string_pretty(&econ_facts_json).unwrap_or_default())
        .await.unwrap_or_else(|e| tracing::warn!("Failed to save econ_facts.json: {}", e));

    send_step(effective_tx, steps, AgentStep {
        step_type: StepType::ToolResult,
        content: "[Pass 1/3] compact_analysis + econ_facts complete".to_string(),
        tool_name: Some("pass1".to_string()),
        tool_input: None,
        tool_output: None,
    })
    .await;

    Ok((compact_analysis, econ_facts_json))
}