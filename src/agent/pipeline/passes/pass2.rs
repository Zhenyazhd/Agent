use futures::future::join_all;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, Semaphore};

use crate::agent::{Agent, AgentStep, StepType};
use crate::agent::run_free_stream;
use crate::agent::pipeline::executor::PipelineOutput;
use crate::agent::pipeline::report::append_to_report;
use crate::agent::pipeline::utils::{flush_steps, local_tx, send_step, truncate_json};
use crate::agent::prompts::{
    ECON_HYPOTHESIS_SYSTEM, PHASE_DEEP_DIVE_SYSTEM, SOURCE_ANALYSIS_SYSTEM,
    hypothesis_prompt, loop_analysis_prompt, phase_deep_dive_prompt, source_analysis_prompt,
};
use crate::error::AgentError;

pub async fn run_pass2(
    agent: &Agent,
    pipeline_out: PipelineOutput,
    compact_traces_json: serde_json::Value,
    econ_facts_json: serde_json::Value, 
    all_traces: Vec<serde_json::Value>, 
    report_path: PathBuf,
    effective_tx: &mpsc::Sender<AgentStep>,
    sem: Arc<Semaphore>,
    total_iterations: &mut usize,
    steps: &mut Vec<AgentStep>,
) -> Result<(), AgentError> {
    let phases_content = tokio::fs::read_to_string(pipeline_out.tx_dir.join("phases.json"))
        .await
        .unwrap_or_else(|_| "[]".to_string());
    let loop_groups_content = tokio::fs::read_to_string(pipeline_out.tx_dir.join("loop_groups.json"))
        .await
        .unwrap_or_else(|_| "[]".to_string());

    send_step(effective_tx, steps, AgentStep {
        step_type: StepType::ToolCall,
        content: "[Pass 2/3] hypothesis ‖ source×N ‖ phase×M ‖ loop×5 starting in parallel".to_string(),
        tool_name: Some("pass2".to_string()),
        tool_input: None, tool_output: None,
    }).await;

    let phases: Vec<serde_json::Value> = serde_json::from_str(&phases_content).unwrap_or_default();
    let loop_groups: Vec<serde_json::Value> = serde_json::from_str(&loop_groups_content).unwrap_or_default();

    let source_inputs: Vec<(String, String)> = pipeline_out.address_files.iter().map(|addr_file| {
        let contract_addr = addr_file.rfind('_')
            .map(|p| addr_file[p + 1..].strip_suffix(".json").unwrap_or(&addr_file[p + 1..]).to_string())
            .unwrap_or_else(|| addr_file.strip_suffix(".json").unwrap_or(addr_file).to_string());

        let mut relevant_functions = std::collections::HashSet::new();
        if let Some(arr) = compact_traces_json.as_array() {
            {
                for trace in arr {
                    if trace["to"].as_str().map_or(false, |a| a.eq_ignore_ascii_case(&contract_addr)) {
                        if let Some(f) = trace["func"].as_str() { relevant_functions.insert(f.to_string()); }
                        if let Some(s) = trace["effective_signature"].as_str() { relevant_functions.insert(s.to_string()); }
                    }
                }
            }
        }
        for key in &["price_quotes", "buys", "sells"] {
            if let Some(arr) = econ_facts_json.get(key).and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(f) = item.get("func").and_then(|v| v.as_str()) {
                        relevant_functions.insert(f.to_string());
                    }
                }
            }
        }
        let funcs: Vec<String> = relevant_functions.into_iter().collect();
        let prompt = source_analysis_prompt(addr_file, &funcs);
        (addr_file.clone(), prompt)
    }).collect();

    let source_futures = source_inputs.iter().map(|(_, prompt)| {
        let sem = sem.clone();
        async move {
            let _permit = sem.acquire_owned().await.expect("semaphore closed");
            run_free_stream(agent, prompt, Vec::new(),
                Some(SOURCE_ANALYSIS_SYSTEM.to_string()), None, local_tx()).await
        }
    });

    let phase_inputs: Vec<(String, String, Vec<u32>, String)> = phases.iter().filter_map(|phase| {
        let phase_name = phase["name"].as_str().unwrap_or("unknown").to_string();
        let call_ids: Vec<u64> = phase["call_ids"].as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
            .unwrap_or_default();
        if call_ids.is_empty() { return None; }
        let phase_traces: Vec<serde_json::Value> = compact_traces_json.as_array().unwrap_or(&vec![])
            .iter().filter_map(|t| {
                let id = t["call_id"].as_u64()?;
                if call_ids.contains(&id) { Some(t.clone()) } else { None }
            }).collect();
        let phase_traces_json = serde_json::to_string_pretty(&phase_traces).unwrap_or_default();
        let call_ids_u32: Vec<u32> = call_ids.iter().map(|&x| x as u32).collect();
        let prompt = phase_deep_dive_prompt(
            &phase_name,
            phase["description"].as_str().unwrap_or(""),
            &call_ids_u32,
            &truncate_json(&phase_traces_json, 30_000),
            &pipeline_out.address_files,
        );
        Some((phase_name, phase["description"].as_str().unwrap_or("").to_string(), call_ids_u32, prompt))
    }).collect();

    let phase_futures = phase_inputs.iter().map(|(_, _, _, prompt)| {
        let sem = sem.clone();
        async move {
            let _permit = sem.acquire_owned().await.expect("semaphore closed");
            run_free_stream(agent, prompt, Vec::new(),
                Some(PHASE_DEEP_DIVE_SYSTEM.to_string()), None, local_tx()).await
        }
    });

    let loop_inputs: Vec<(String, u64, String)> = loop_groups.iter().take(5).filter_map(|lg| {
        let loop_name = lg["name"].as_str().unwrap_or("unknown").to_string();
        let total_calls = lg["total_calls"].as_u64().unwrap_or(0);
        if total_calls == 0 { return None; }
        let pattern_str = serde_json::to_string(lg["pattern"].as_array().unwrap_or(&vec![])).unwrap_or_default();
        let prompt = loop_analysis_prompt(
            &loop_name, total_calls as usize, &pattern_str,
            &truncate_json(&serde_json::to_string_pretty(lg).unwrap_or_default(), 20_000),
            &pipeline_out.address_files,
        );
        Some((loop_name, total_calls, prompt))
    }).collect();

    let loop_futures = loop_inputs.iter().map(|(_, _, prompt)| {
        let sem = sem.clone();
        async move {
            let _permit = sem.acquire_owned().await.expect("semaphore closed");
            run_free_stream(agent, prompt, Vec::new(),
                Some(PHASE_DEEP_DIVE_SYSTEM.to_string()), None, local_tx()).await
        }
    });

    let hypothesis_prompt_str = hypothesis_prompt(
        &serde_json::to_string_pretty(&econ_facts_json).unwrap_or_default(),
        all_traces.len(),
        &pipeline_out.address_files,
    );

    let hypothesis_fut = {
        let sem = sem.clone();
        async move {
            let _permit = sem.acquire_owned().await.expect("semaphore closed");
            run_free_stream(agent, &hypothesis_prompt_str, Vec::new(),
                Some(ECON_HYPOTHESIS_SYSTEM.to_string()), None, local_tx()).await
        }
    };

    let (hypothesis_result, source_results, phase_results, loop_results) = tokio::join!(
        hypothesis_fut,
        join_all(source_futures),
        join_all(phase_futures),
        join_all(loop_futures),
    );

    let hypothesis_text = match hypothesis_result {
        Ok(res) => {
            *total_iterations += res.iterations;
            flush_steps(effective_tx, &res.steps).await;
            steps.extend(res.steps);
            res.final_answer
        }
        Err(e) => { tracing::warn!("Hypothesis generation failed: {}", e); format!("## Hypotheses & Tests\n\n*Failed: {}*", e) }
    };

    append_to_report(&report_path, "---\n\n## Hypotheses & Tests\n\n").await;
    append_to_report(&report_path, &format!("{}\n\n", hypothesis_text)).await;

    append_to_report(&report_path, "## Source Code Analysis\n\n").await;
    for (i, result) in source_results.into_iter().enumerate() {
        let addr_file = source_inputs.get(i).map(|(f, _)| f.as_str()).unwrap_or("?");
        let text = match result {
            Ok(res) => {
                *total_iterations += res.iterations;
                flush_steps(effective_tx, &res.steps).await;
                steps.extend(res.steps);
                res.final_answer
            }
            Err(e) => { tracing::warn!("Source analysis failed for {}: {}", addr_file, e); format!("### Contract: {}\n\n*Analysis failed: {}*", addr_file, e) }
        };
        append_to_report(&report_path, &format!("{}\n\n", text)).await;
    }

    append_to_report(&report_path, "---\n\n## Phase Deep Dives\n\n").await;
    for (i, result) in phase_results.into_iter().enumerate() {
        let phase_name = phase_inputs.get(i).map(|(n, _, _, _)| n.as_str()).unwrap_or("?");
        let text = match result {
            Ok(res) => {
                *total_iterations += res.iterations;
                flush_steps(effective_tx, &res.steps).await;
                steps.extend(res.steps);
                res.final_answer
            }
            Err(e) => { tracing::warn!("Phase analysis failed for {}: {}", phase_name, e); format!("### Phase: {}\n\n*Analysis failed: {}*", phase_name, e) }
        };
        append_to_report(&report_path, &format!("{}\n\n", text)).await;
    }
    for (i, result) in loop_results.into_iter().enumerate() {
        let loop_name = loop_inputs.get(i).map(|(n, _, _)| n.as_str()).unwrap_or("?");
        let text = match result {
            Ok(res) => {
                *total_iterations += res.iterations;
                flush_steps(effective_tx, &res.steps).await;
                steps.extend(res.steps);
                res.final_answer
            }
            Err(e) => { tracing::warn!("Loop analysis failed for {}: {}", loop_name, e); format!("### Loop: {}\n\n*Analysis failed: {}*", loop_name, e) }
        };
        append_to_report(&report_path, &format!("{}\n\n", text)).await;
    }

    send_step(effective_tx, steps, AgentStep {
        step_type: StepType::ToolResult,
        content: "[Pass 2/3] hypothesis + sources + phases + loops complete".to_string(),
        tool_name: Some("pass2".to_string()),
        tool_input: None, tool_output: None,
    }).await;
    
    Ok(())
}