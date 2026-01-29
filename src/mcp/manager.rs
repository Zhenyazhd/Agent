use anyhow::{Context, Result};
use reqwest::Client as HttpClient;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::env;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info};

use crate::mcp::connection::McpTransport;
use crate::mcp::protocol::{create_init_params, JsonRpcRequest};
use crate::mcp::types::{McpConfig, McpResource, McpServerConfig, McpServerInfo, McpTool};

struct McpServerInstance {
    name: String,
    transport: McpTransport,
    request_id: u64,
    tools: Vec<McpTool>,
    #[allow(dead_code)]
    resources: Vec<McpResource>,
}

impl McpServerInstance {
    fn new(name: String, transport: McpTransport) -> Self {
        Self {
            name,
            transport,
            request_id: 0,
            tools: Vec::new(),
            resources: Vec::new(),
        }
    }

    async fn send_request(&mut self, method: &str, params: Option<Value>) -> Result<Value> {
        self.request_id += 1;
        let request = JsonRpcRequest::new(self.request_id, method, params);

        let response = self.transport.send(&request).await?;
        response
            .into_result()
            .context(format!("MCP server '{}'", self.name))
    }

    async fn initialize(&mut self) -> Result<()> {
        let init_params = create_init_params();
        let init_result = self.send_request("initialize", Some(init_params)).await?;
        debug!("[{}] Initialize result: {:?}", self.name, init_result);

        let _ = self
            .send_request("notifications/initialized", None)
            .await;

        if let Ok(tools_result) = self.send_request("tools/list", None).await {
            if let Some(tools) = tools_result.get("tools") {
                self.tools = serde_json::from_value(tools.clone()).unwrap_or_default();
                info!(
                    "[{}] Discovered {} tools: {:?}",
                    self.name,
                    self.tools.len(),
                    self.tools.iter().map(|t| &t.name).collect::<Vec<_>>()
                );
            }
        }

        // Discover resources
        if let Ok(resources_result) = self.send_request("resources/list", None).await {
            if let Some(resources) = resources_result.get("resources") {
                self.resources = serde_json::from_value(resources.clone()).unwrap_or_default();
                info!("[{}] Discovered {} resources", self.name, self.resources.len());
            }
        }

        Ok(())
    }
}

pub struct McpManager {
    servers: Arc<RwLock<HashMap<String, McpServerInstance>>>,
    config: Arc<RwLock<McpConfig>>,
    enabled_servers: Arc<RwLock<HashSet<String>>>,
    http_client: HttpClient,
}

impl McpManager {
    pub fn load_config<P: AsRef<Path>>(path: P) -> Result<McpConfig> {
        let content = std::fs::read_to_string(path)?;
        let content = Self::expand_env_vars(&content);
        let config: McpConfig = serde_json::from_str(&content)?;
        Ok(config)
    }

    fn expand_env_vars(content: &str) -> String {
        let mut result = content.to_string();
        let re = regex::Regex::new(r"\$\{(\w+)\}").unwrap();

        for cap in re.captures_iter(content) {
            let var_name = &cap[1];
            let var_value = env::var(var_name).unwrap_or_default();
            result = result.replace(&cap[0], &var_value);
        }

        result
    }

    pub fn new(config: McpConfig) -> Self {
        let enabled: HashSet<String> = config
            .mcp_servers
            .iter()
            .filter(|(_, cfg)| !cfg.disabled)
            .map(|(name, _)| name.clone())
            .collect();

        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            config: Arc::new(RwLock::new(config)),
            enabled_servers: Arc::new(RwLock::new(enabled)),
            http_client: HttpClient::new(),
        }
    }

    pub async fn connect_all(&self) -> Result<()> {
        let config = self.config.read().await;
        let enabled = self.enabled_servers.read().await;

        for (name, server_config) in &config.mcp_servers {
            if !enabled.contains(name) {
                info!("Skipping disabled MCP server: {}", name);
                continue;
            }

            match self.connect_server(name, server_config).await {
                Ok(_) => info!("Connected to MCP server: {}", name),
                Err(e) => error!("Failed to connect to MCP server {}: {}", name, e),
            }
        }
        Ok(())
    }

    async fn connect_server(&self, name: &str, config: &McpServerConfig) -> Result<()> {
        let transport_type = config.transport_type.as_deref().unwrap_or("stdio");

        let transport = match transport_type {
            "streamable-http" | "http" => {
                let url = config
                    .url
                    .as_ref()
                    .context("HTTP transport requires 'url' field")?;
                info!("Connecting to MCP HTTP server: {} at {}", name, url);
                McpTransport::http(self.http_client.clone(), url.clone())
            }
            _ => {
                let command = config
                    .command
                    .as_ref()
                    .context("Stdio transport requires 'command' field")?;
                info!("Starting MCP server: {} ({})", name, command);
                McpTransport::spawn_stdio(command, &config.args, &config.env)?
            }
        };

        let mut instance = McpServerInstance::new(name.to_string(), transport);
        instance.initialize().await?;

        self.servers.write().await.insert(name.to_string(), instance);
        Ok(())
    }

    pub async fn enable_server(&self, name: &str) -> Result<()> {
        let config = self.config.read().await;
        let server_config = config
            .mcp_servers
            .get(name)
            .context(format!("Server {} not found in config", name))?
            .clone();
        drop(config);

        self.enabled_servers.write().await.insert(name.to_string());

        if !self.servers.read().await.contains_key(name) {
            self.connect_server(name, &server_config).await?;
        }

        info!("Enabled MCP server: {}", name);
        Ok(())
    }

    pub async fn disable_server(&self, name: &str) -> Result<()> {
        self.enabled_servers.write().await.remove(name);

        if self.servers.write().await.remove(name).is_some() {
            info!("Disabled and disconnected MCP server: {}", name);
        } else {
            info!("Disabled MCP server: {}", name);
        }

        Ok(())
    }

    pub async fn get_servers_status(&self) -> Vec<McpServerInfo> {
        let config = self.config.read().await;
        let enabled = self.enabled_servers.read().await;
        let servers = self.servers.read().await;

        config
            .mcp_servers
            .iter()
            .map(|(name, cfg)| {
                let connected_instance = servers.get(name);
                let tools: Vec<String> = connected_instance
                    .map(|i| i.tools.iter().map(|t| t.name.clone()).collect())
                    .unwrap_or_default();

                McpServerInfo {
                    name: name.clone(),
                    enabled: enabled.contains(name),
                    connected: connected_instance.is_some(),
                    transport_type: cfg
                        .transport_type
                        .clone()
                        .unwrap_or_else(|| "stdio".to_string()),
                    tools_count: tools.len(),
                    tools,
                }
            })
            .collect()
    }

    pub async fn get_all_tools(&self) -> Vec<(String, McpTool)> {
        let servers = self.servers.read().await;
        let enabled = self.enabled_servers.read().await;
        let mut all_tools = Vec::new();

        for (server_name, instance) in servers.iter() {
            if enabled.contains(server_name) {
                for tool in &instance.tools {
                    all_tools.push((server_name.clone(), tool.clone()));
                }
            }
        }

        all_tools
    }

    pub async fn call_tool(
        &self,
        server_name: &str,
        tool_name: &str,
        arguments: Value,
    ) -> Result<Value> {
        if !self.enabled_servers.read().await.contains(server_name) {
            anyhow::bail!("Server {} is disabled", server_name);
        }

        let mut servers = self.servers.write().await;
        let instance = servers
            .get_mut(server_name)
            .context(format!("Server {} not connected", server_name))?;

        let params = serde_json::json!({
            "name": tool_name,
            "arguments": arguments
        });

        instance.send_request("tools/call", Some(params)).await
    }

    pub async fn call_tool_by_full_name(
        &self,
        full_name: &str,
        arguments: Value,
    ) -> Result<Value> {
        let parts: Vec<&str> = full_name.splitn(2, '_').collect();
        if parts.len() != 2 {
            anyhow::bail!("Invalid tool name format: {}", full_name);
        }

        let server_name = parts[0];
        let tool_name = parts[1];

        self.call_tool(server_name, tool_name, arguments).await
    }

    pub async fn call_tool_text(
        &self,
        server_name: &str,
        tool_name: &str,
        arguments: Value,
    ) -> Result<String> {
        let result = self.call_tool(server_name, tool_name, arguments).await?;
        Ok(Self::extract_text(&result))
    }

    fn extract_text(result: &Value) -> String {
        if let Some(content) = result.get("content") {
            if let Some(arr) = content.as_array() {
                return arr
                    .iter()
                    .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n");
            }
            return content.to_string();
        }
        result.to_string()
    }

    pub async fn connected_servers(&self) -> Vec<String> {
        self.servers.read().await.keys().cloned().collect()
    }
}
