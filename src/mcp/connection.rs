use anyhow::{Context, Result};
use reqwest::Client as HttpClient;
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tracing::debug;

use crate::mcp::protocol::{parse_sse_response, JsonRpcRequest, JsonRpcResponse};

pub enum McpTransport {
    Stdio {
        process: Child,
        stdin: ChildStdin,
        stdout: BufReader<ChildStdout>,
    },
    Http {
        client: HttpClient,
        url: String,
    },
}

impl McpTransport {
    pub fn spawn_stdio(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<Self> {
        let (cmd, extra_args) = if command.contains(' ') {
            let parts: Vec<&str> = command.split_whitespace().collect();
            (parts[0].to_string(), parts[1..].to_vec())
        } else {
            (command.to_string(), vec![])
        };

        let mut process_cmd = Command::new(&cmd);

        for arg in extra_args {
            process_cmd.arg(arg);
        }

        process_cmd.args(args);
        process_cmd.stdin(Stdio::piped());
        process_cmd.stdout(Stdio::piped());
        process_cmd.stderr(Stdio::piped());

        for (key, value) in env {
            if !value.is_empty() {
                process_cmd.env(key, value);
            }
        }

        let mut process = process_cmd
            .spawn()
            .context("Failed to spawn MCP server process")?;

        let stdin = process.stdin.take().context("Failed to get stdin")?;
        let stdout = process.stdout.take().context("Failed to get stdout")?;

        Ok(Self::Stdio {
            process,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    pub fn http(client: HttpClient, url: String) -> Self {
        Self::Http { client, url }
    }

    pub async fn send(&mut self, request: &JsonRpcRequest) -> Result<JsonRpcResponse> {
        match self {
            Self::Stdio { stdin, stdout, .. } => {
                Self::send_stdio(stdin, stdout, request).await
            }
            Self::Http { client, url } => {
                Self::send_http(client, url, request).await
            }
        }
    }

    async fn send_stdio(
        stdin: &mut ChildStdin,
        stdout: &mut BufReader<ChildStdout>,
        request: &JsonRpcRequest,
    ) -> Result<JsonRpcResponse> {
        let request_str = serde_json::to_string(request)?;
        debug!("Stdio sending: {}", request_str);

        stdin
            .write_all(format!("{}\n", request_str).as_bytes())
            .await?;
        stdin.flush().await?;

        loop {
            let mut line = String::new();
            let bytes_read = stdout.read_line(&mut line).await?;

            if bytes_read == 0 {
                anyhow::bail!("Server closed stdout unexpectedly");
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(trimmed) {
                debug!("Stdio received: {}", trimmed);
                return Ok(response);
            }

            debug!("Stdio ignored non-JSON-RPC: {}", trimmed);
        }
    }

    async fn send_http(
        client: &HttpClient,
        url: &str,
        request: &JsonRpcRequest,
    ) -> Result<JsonRpcResponse> {
        debug!("HTTP request to {}: {:?}", url, request);

        let http_response = client
            .post(url)
            .header("Accept", "application/json, text/event-stream")
            .json(request)
            .send()
            .await?;

        let content_type = http_response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let body = http_response.text().await?;
        debug!("HTTP response ({}): {}", content_type, &body[..body.len().min(500)]);

        let json_str = if content_type.contains("text/event-stream") {
            parse_sse_response(&body)
        } else {
            body
        };

        serde_json::from_str(&json_str).context(format!(
            "Failed to parse JSON-RPC response: {}",
            &json_str[..json_str.len().min(200)]
        ))
    }
}

impl Drop for McpTransport {
    fn drop(&mut self) {
        if let Self::Stdio { process, .. } = self {
            let _ = process.start_kill();
        }
    }
}
