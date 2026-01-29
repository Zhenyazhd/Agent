use crate::config::Config;
use crate::error::AgentError;
use crate::mcp::McpManager;
use crate::models::{FunctionDefinition, Message, MessageFunctionCall, MessageToolCall, Tool};
use crate::openrouter::OpenRouterClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::{debug, info, warn};

const MAX_ITERATIONS: usize = 10;

pub struct Agent {
    client: OpenRouterClient,
    config: Config,
    mcp: Option<Arc<McpManager>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentStep {
    pub step_type: StepType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StepType {
    Thinking,
    ToolCall,
    ToolResult,
    FinalAnswer,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentResponse {
    pub steps: Vec<AgentStep>,
    pub final_answer: String,
    pub iterations: usize,
}

impl Agent {
    pub fn new(config: Config, mcp: Option<Arc<McpManager>>) -> Self {
        Self {
            client: OpenRouterClient::new(config.clone()),
            config,
            mcp,
        }
    }

    pub async fn get_tools(&self) -> Vec<Tool> {
        let Some(ref mcp) = self.mcp else {
            return Vec::new();
        };

        mcp.get_all_tools()
            .await
            .into_iter()
            .map(|(server_name, tool)| Tool {
                tool_type: "function".to_string(),
                function: FunctionDefinition {
                    name: format!("mcp_{}_{}", server_name, tool.name),
                    description: tool
                        .description
                        .unwrap_or_else(|| format!("MCP tool from {}", server_name)),
                    parameters: tool.input_schema,
                },
            })
            .collect()
    }

    fn parse_mcp_tool_name(name: &str) -> Option<(String, String)> {
        let rest = name.strip_prefix("mcp_")?;
        let pos = rest.find('_')?;
        Some((rest[..pos].to_string(), rest[pos + 1..].to_string()))
    }

    async fn execute_tool(&self, tool_name: &str, args_json: &str) -> Result<String, AgentError> {
        let (server_name, mcp_tool_name) = Self::parse_mcp_tool_name(tool_name)
            .ok_or_else(|| AgentError::ToolError(format!("Unknown tool: {}", tool_name)))?;

        let mcp = self.mcp.as_ref()
            .ok_or_else(|| AgentError::ToolError("MCP not configured".to_string()))?;

        let args: Value = serde_json::from_str(args_json)
            .map_err(|e| AgentError::ToolError(format!("Invalid arguments: {}", e)))?;

        mcp.call_tool_text(&server_name, &mcp_tool_name, args)
            .await
            .map_err(|e| AgentError::ToolError(e.to_string()))
    }

    pub async fn run(
        &self,
        user_message: &str,
        conversation_history: Vec<Message>,
        system_prompt: Option<String>,
        model: Option<String>,
    ) -> Result<AgentResponse, AgentError> {
        let system_prompt = system_prompt.unwrap_or_else(|| self.config.system_prompt.clone());

        let mut messages = vec![Message::system(&system_prompt)];
        messages.extend(conversation_history);
        messages.push(Message::user(user_message));

        let tools = self.get_tools().await;
        info!("Agent has {} MCP tools available", tools.len());

        let model = model.unwrap_or_else(|| self.config.default_model.clone());
        let mut steps = Vec::new();
        let mut iterations = 0;

        loop {
            iterations += 1;
            if iterations > MAX_ITERATIONS {
                steps.push(AgentStep {
                    step_type: StepType::Error,
                    content: "Maximum iterations reached".to_string(),
                    tool_name: None,
                    tool_input: None,
                    tool_output: None,
                });
                break;
            }

            info!("Agent iteration {}", iterations);
            debug!("Messages: {:?}", messages);

            let response = self
                .client
                .chat_completion_with_tools(messages.clone(), Some(model.clone()), Some(tools.clone()))
                .await?;

            let choice = response
                .choices
                .first()
                .ok_or_else(|| AgentError::ParseError("No choices in response".to_string()))?;

            let Some(tool_calls) = &choice.message.tool_calls else {
                return Ok(self.create_final_response(steps, &choice.message.content, iterations));
            };

            if tool_calls.is_empty() {
                return Ok(self.create_final_response(steps, &choice.message.content, iterations));
            }

            if let Some(ref content) = choice.message.content {
                if !content.is_empty() {
                    steps.push(AgentStep {
                        step_type: StepType::Thinking,
                        content: content.clone(),
                        tool_name: None,
                        tool_input: None,
                        tool_output: None,
                    });
                }
            }

            let message_tool_calls: Vec<MessageToolCall> = tool_calls
                .iter()
                .map(|tc| MessageToolCall {
                    id: tc.id.clone(),
                    call_type: "function".to_string(),
                    function: MessageFunctionCall {
                        name: tc.function.name.clone(),
                        arguments: tc.function.arguments.clone(),
                    },
                })
                .collect();

            messages.push(Message::assistant_with_tool_calls(
                choice.message.content.clone(),
                message_tool_calls,
            ));

            for tool_call in tool_calls {
                let tool_name = &tool_call.function.name;
                let tool_args = &tool_call.function.arguments;

                steps.push(AgentStep {
                    step_type: StepType::ToolCall,
                    content: format!("Calling: {}", tool_name),
                    tool_name: Some(tool_name.clone()),
                    tool_input: Some(tool_args.clone()),
                    tool_output: None,
                });

                let (step_type, result) = match self.execute_tool(tool_name, tool_args).await {
                    Ok(text) => (StepType::ToolResult, text),
                    Err(e) => {
                        warn!("Tool execution failed: {}", e);
                        (StepType::Error, format!("Error: {}", e))
                    }
                };
                steps.push(AgentStep {
                    step_type,
                    content: result.clone(),
                    tool_name: Some(tool_name.clone()),
                    tool_input: None,
                    tool_output: Some(result.clone()),
                });
                messages.push(Message::tool_result(&tool_call.id, result));
            }
        }
        let final_answer = steps
            .iter()
            .rev()
            .find(|s| matches!(s.step_type, StepType::Thinking | StepType::ToolResult))
            .map(|s| s.content.clone())
            .unwrap_or_else(|| "Task incomplete: iteration limit reached.".to_string());

        Ok(AgentResponse {
            steps,
            final_answer,
            iterations,
        })
    }

    fn create_final_response(
        &self,
        mut steps: Vec<AgentStep>,
        content: &Option<String>,
        iterations: usize,
    ) -> AgentResponse {
        let final_answer = content.clone().unwrap_or_default();

        steps.push(AgentStep {
            step_type: StepType::FinalAnswer,
            content: final_answer.clone(),
            tool_name: None,
            tool_input: None,
            tool_output: None,
        });

        AgentResponse {
            steps,
            final_answer,
            iterations,
        }
    }
}
