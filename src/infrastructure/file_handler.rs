
use tokio::fs;
use std::path::PathBuf;
use tracing::warn;

pub(crate) async fn handle_large_result(workspace_dir: &str, tool_name: &str, result: &str, max_chars: usize) -> String {
    if result.len() <= max_chars {
        return result.to_string();
    }
    let results_dir = PathBuf::from(workspace_dir).join("tool_results");
    if let Err(e) = fs::create_dir_all(&results_dir).await {
        warn!("Failed to create tool_results dir: {}", e);
        return truncate_result(result, max_chars);
    }

    let safe_tool_name: String = tool_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
        .collect();

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}_{}.txt", safe_tool_name, timestamp);

    let canonical_dir = match results_dir.canonicalize() {
        Ok(d) => d,
        Err(e) => {
            warn!("Failed to canonicalize tool_results dir: {}", e);
            return truncate_result(result, max_chars);
        }
    };

    let file_path = canonical_dir.join(&filename);

    if !file_path.starts_with(&canonical_dir) {
        warn!("Constructed path escapes workspace dir, rejecting write");
        return truncate_result(result, max_chars);
    }

    match fs::write(&file_path, result).await {
        Ok(_) => {
            let size_kb = result.len() as f64 / 1024.0;
            let preview_len = max_chars.min(result.len());
            let preview = &result[..preview_len];
            format!(
                "{}\n\n[OUTPUT TRUNCATED - Full result ({:.1} KB) saved to: {}]\n\
                Use read_file_chunk tool to read the full file.",
                preview, size_kb, file_path.display()
            )
        }
        Err(e) => {
            warn!("Failed to save large result: {}", e);
            truncate_result(result, max_chars)
        }
    }
}

pub(crate) fn truncate_result(result: &str, max_chars: usize) -> String {
    let truncate_at = result[..max_chars.min(result.len())]
        .rfind('\n')
        .unwrap_or(max_chars.min(result.len()));
    let truncated = &result[..truncate_at];
    format!(
        "{}\n\n[TRUNCATED: {} of {} chars]",
        truncated, truncate_at, result.len()
    )
}
