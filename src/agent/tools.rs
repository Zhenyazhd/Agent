use super::Agent;
use crate::error::AgentError;
use crate::mcp::McpManager;
use crate::models::{FunctionDefinition, Tool};
use serde_json::Value;


pub(crate) fn split_server_tool(s: &str) -> Option<(&str, &str)> {
    let pos = s.find('_')?;
    Some((&s[..pos], &s[pos + 1..]))
}

pub(crate) fn make_mcp_tool_name(server: &str, tool: &str) -> String {
    format!("mcp_{}_{}", server, tool)
}


impl Agent {
    pub async fn get_tools(&self) -> Vec<Tool> {
        let Some(mcp) = self.mcp() else {
            return Vec::new();
        };
        mcp.get_all_tools()
            .await
            .into_iter()
            .map(|(server_name, tool)| Tool {
                tool_type: "function".to_string(),
                function: FunctionDefinition {
                    name: make_mcp_tool_name(&server_name, &tool.name),
                    description: tool
                        .description
                        .unwrap_or_else(|| format!("MCP tool from {}", server_name)),
                    parameters: tool.input_schema,
                },
            })
            .collect()
    }

    pub(crate) fn parse_mcp_tool_name(name: &str) -> Option<(String, String)> {
        let rest = name.strip_prefix("mcp_")?;
        let (server, tool) = split_server_tool(rest)?;
        Some((server.to_string(), tool.to_string()))
    }

    pub(crate) async fn execute_tool(&self, tool_name: &str, args_json: &str) -> Result<String, AgentError> {
        let (server_name, mcp_tool_name) = Self::parse_mcp_tool_name(tool_name)
            .ok_or_else(|| AgentError::ToolError(format!("Unknown tool: {}", tool_name)))?;
        let mcp = self
            .mcp()
            .ok_or_else(|| AgentError::ToolError("MCP not configured".to_string()))?;
        let args: Value = serde_json::from_str(args_json)
            .map_err(|e| AgentError::ToolError(format!("Invalid arguments: {}", e)))?;
        let result = mcp.call_tool(&server_name, &mcp_tool_name, args)
            .await
            .map_err(|e| AgentError::ToolError(e.to_string()))?;
        Ok(McpManager::extract_text(&result))
    }
}
