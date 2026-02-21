use std::path::PathBuf;

pub(crate) async fn append_to_report(path: &PathBuf, content: &str) {
    use tokio::fs::OpenOptions;
    use tokio::io::AsyncWriteExt;

    match OpenOptions::new().append(true).open(path).await {
        Ok(mut file) => {
            if let Err(e) = file.write_all(content.as_bytes()).await {
                tracing::warn!("Failed to append to report: {}", e);
            }
        }
        Err(e) => tracing::warn!("Failed to open report for append: {}", e),
    }
}
