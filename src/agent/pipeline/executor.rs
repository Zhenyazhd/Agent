use std::path::PathBuf;
use tokio::process::Command;
use tracing::info;
use crate::error::AgentError;

pub(crate) struct PipelineOutput {
    pub(crate) trace_doc_count: u64,
    pub(crate) trace_files: Vec<String>,
    pub(crate) address_files: Vec<String>,
    pub(crate) tx_dir: PathBuf,
}

pub(crate) async fn run_ts_pipeline(
    tx_hash: &str,
    chain_id: u64,
    workspace_dir: &str,
) -> Result<PipelineOutput, AgentError> {
    let dir =  PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("decode_tx");

    info!(
        "[Pipeline] Running TS pipeline for {} on chain {}",
        tx_hash, chain_id
    );

    let output = Command::new("npx")
        .args([
            "tsx",
            "src/cli/pipeline.ts",
            tx_hash,
            &chain_id.to_string(),
        ])
        .env("WORKSPACE_DIR", workspace_dir)
        .current_dir(&dir)
        .output()
        .await
        .map_err(|e| AgentError::ToolError(format!("Failed to run pipeline: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(AgentError::ToolError(format!(
            "Pipeline failed:\n{}\n{}",
            stderr, stdout
        )));
    }

    let tx_dir = PathBuf::from(workspace_dir).join(tx_hash);
    let meta_path = tx_dir.join("tx_meta.json");

    let meta_content = tokio::fs::read_to_string(&meta_path)
        .await
        .map_err(|e| {
            AgentError::ToolError(format!(
                "Failed to read tx_meta.json at {}: {}",
                meta_path.display(),
                e
            ))
        })?;

    let meta: serde_json::Value = serde_json::from_str(&meta_content)
        .map_err(|e| AgentError::ToolError(format!("Failed to parse tx_meta.json: {}", e)))?;

    let addresses: Vec<String> = meta["addresses"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let trace_doc_count = meta["trace_doc_count"].as_u64().unwrap_or(0);

    // Collect trace files sorted by call_id
    let mut trace_files: Vec<String> = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&tx_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("trace_") && name.ends_with(".json") {
                trace_files.push(entry.path().to_string_lossy().to_string());
            }
        }
    }
    trace_files.sort();

    let mut address_files: Vec<String> = Vec::new();
    for addr in &addresses {
        let p = PathBuf::from(workspace_dir)
            .join(format!("{}_{}.json", chain_id, addr.to_lowercase()))
            .to_string_lossy()
            .to_string();
        if tokio::fs::try_exists(&p).await.unwrap_or(false) {
            address_files.push(p);
        }
    }

    Ok(PipelineOutput {
        trace_doc_count,
        trace_files,
        address_files,
        tx_dir,
    })
}
