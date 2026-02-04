use crate::config::{AgentMode, Config};
use crate::error::AgentError;
use crate::mcp::McpManager;
use crate::models::{FunctionDefinition, Message, MessageFunctionCall, MessageToolCall, Tool};
use crate::openrouter::OpenRouterClient;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

const MAX_ITERATIONS: usize = 50;
const MAX_TOOL_RESULT_CHARS: usize = 100_000;


#[derive(Clone)]
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

// ============================================================================
// Agent Implementation
// ============================================================================

impl Agent {
    pub fn new(config: Config, mcp: Option<Arc<McpManager>>) -> Self {
        Self {
            client: OpenRouterClient::new(config.clone()),
            config,
            mcp,
        }
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    async fn handle_large_result(workspace_dir: &str, tool_name: &str, result: &str) -> String {
        if result.len() <= MAX_TOOL_RESULT_CHARS {
            return result.to_string();
        }

        let results_dir = PathBuf::from(workspace_dir).join("tool_results");
        if let Err(e) = fs::create_dir_all(&results_dir).await {
            warn!("Failed to create tool_results dir: {}", e);
            return Self::truncate_result(result);
        }

        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let safe_tool_name = tool_name
            .replace("mcp_", "")
            .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
        let filename = format!("{}_{}.txt", safe_tool_name, timestamp);
        let file_path = results_dir.join(&filename);

        match fs::write(&file_path, result).await {
            Ok(_) => {
                let size_kb = result.len() as f64 / 1024.0;
                let preview_len = MAX_TOOL_RESULT_CHARS.min(result.len());
                let preview = &result[..preview_len];

                format!(
                    "{}\n\n[OUTPUT TRUNCATED - Full result ({:.1} KB) saved to: {}]\n\
                    Use read_file_chunk tool to read the full file.",
                    preview,
                    size_kb,
                    file_path.display()
                )
            }
            Err(e) => {
                warn!("Failed to save large result: {}", e);
                Self::truncate_result(result)
            }
        }
    }

    fn truncate_result(result: &str) -> String {
        let truncate_at = result[..MAX_TOOL_RESULT_CHARS]
            .rfind('\n')
            .unwrap_or(MAX_TOOL_RESULT_CHARS);
        let truncated = &result[..truncate_at];
        format!(
            "{}\n\n[TRUNCATED: {} of {} chars]",
            truncated, truncate_at, result.len()
        )
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

        let mcp = self
            .mcp
            .as_ref()
            .ok_or_else(|| AgentError::ToolError("MCP not configured".to_string()))?;

        let args: Value = serde_json::from_str(args_json)
            .map_err(|e| AgentError::ToolError(format!("Invalid arguments: {}", e)))?;

        mcp.call_tool_text(&server_name, &mcp_tool_name, args)
            .await
            .map_err(|e| AgentError::ToolError(e.to_string()))
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

    pub async fn run(
        &self,
        user_message: &str,
        conversation_history: Vec<Message>,
        system_prompt: Option<String>,
        model: Option<String>,
    ) -> Result<AgentResponse, AgentError> {
        self.run_free(user_message, conversation_history, system_prompt, model)
            .await
    }

    pub async fn run_stream(
        &self,
        user_message: &str,
        conversation_history: Vec<Message>,
        system_prompt: Option<String>,
        model: Option<String>,
        step_tx: mpsc::Sender<AgentStep>,
    ) -> Result<AgentResponse, AgentError> {
        self.run_free_stream(
            user_message,
            conversation_history,
            system_prompt,
            model,
            step_tx,
        )
        .await
    }

    async fn run_free(
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
        info!("[Free Mode] Agent has {} MCP tools available", tools.len());

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
                .chat_completion_with_tools(
                    messages.clone(),
                    Some(model.clone()),
                    Some(tools.clone()),
                )
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

                let processed_result =
                    Self::handle_large_result(&self.config.workspace_dir, tool_name, &result).await;

                steps.push(AgentStep {
                    step_type,
                    content: processed_result.clone(),
                    tool_name: Some(tool_name.clone()),
                    tool_input: None,
                    tool_output: Some(processed_result.clone()),
                });
                messages.push(Message::tool_result(&tool_call.id, processed_result));
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

    async fn run_free_stream(
        &self,
        user_message: &str,
        conversation_history: Vec<Message>,
        system_prompt: Option<String>,
        model: Option<String>,
        step_tx: mpsc::Sender<AgentStep>,
    ) -> Result<AgentResponse, AgentError> {
        let system_prompt = system_prompt.unwrap_or_else(|| self.config.system_prompt.clone());

        let mut messages = vec![Message::system(&system_prompt)];
        messages.extend(conversation_history);
        messages.push(Message::user(user_message));

        let tools = self.get_tools().await;
        info!("[Free Mode] Agent has {} MCP tools available", tools.len());

        let model = model.unwrap_or_else(|| self.config.default_model.clone());
        let mut steps = Vec::new();
        let mut iterations = 0;

        // Send initial "starting" step
        let start_step = AgentStep {
            step_type: StepType::Thinking,
            content: "Starting agent (Free Mode)...".to_string(),
            tool_name: None,
            tool_input: None,
            tool_output: None,
        };
        let _ = step_tx.send(start_step).await;

        loop {
            iterations += 1;
            if iterations > MAX_ITERATIONS {
                let error_step = AgentStep {
                    step_type: StepType::Error,
                    content: "Maximum iterations reached".to_string(),
                    tool_name: None,
                    tool_input: None,
                    tool_output: None,
                };
                let _ = step_tx.send(error_step.clone()).await;
                steps.push(error_step);
                break;
            }

            info!("Agent iteration {}", iterations);
            debug!("Messages: {:?}", messages);

            let iter_step = AgentStep {
                step_type: StepType::Thinking,
                content: format!("Iteration {}...", iterations),
                tool_name: None,
                tool_input: None,
                tool_output: None,
            };
            let _ = step_tx.send(iter_step).await;

            let response = match self
                .client
                .chat_completion_with_tools(
                    messages.clone(),
                    Some(model.clone()),
                    Some(tools.clone()),
                )
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    let error_step = AgentStep {
                        step_type: StepType::Error,
                        content: format!("LLM request failed: {}", e),
                        tool_name: None,
                        tool_input: None,
                        tool_output: None,
                    };
                    let _ = step_tx.send(error_step.clone()).await;
                    steps.push(error_step);
                    return Err(e);
                }
            };

            let choice = match response.choices.first() {
                Some(c) => c,
                None => {
                    let error_step = AgentStep {
                        step_type: StepType::Error,
                        content: "No choices in LLM response".to_string(),
                        tool_name: None,
                        tool_input: None,
                        tool_output: None,
                    };
                    let _ = step_tx.send(error_step.clone()).await;
                    steps.push(error_step);
                    return Err(AgentError::ParseError("No choices in response".to_string()));
                }
            };

            let Some(tool_calls) = &choice.message.tool_calls else {
                let final_step = AgentStep {
                    step_type: StepType::FinalAnswer,
                    content: choice.message.content.clone().unwrap_or_default(),
                    tool_name: None,
                    tool_input: None,
                    tool_output: None,
                };
                let _ = step_tx.send(final_step.clone()).await;
                steps.push(final_step);

                return Ok(AgentResponse {
                    steps,
                    final_answer: choice.message.content.clone().unwrap_or_default(),
                    iterations,
                });
            };

            if tool_calls.is_empty() {
                let final_step = AgentStep {
                    step_type: StepType::FinalAnswer,
                    content: choice.message.content.clone().unwrap_or_default(),
                    tool_name: None,
                    tool_input: None,
                    tool_output: None,
                };
                let _ = step_tx.send(final_step.clone()).await;
                steps.push(final_step);

                return Ok(AgentResponse {
                    steps,
                    final_answer: choice.message.content.clone().unwrap_or_default(),
                    iterations,
                });
            }

            if let Some(ref content) = choice.message.content {
                if !content.is_empty() {
                    let thinking_step = AgentStep {
                        step_type: StepType::Thinking,
                        content: content.clone(),
                        tool_name: None,
                        tool_input: None,
                        tool_output: None,
                    };
                    let _ = step_tx.send(thinking_step.clone()).await;
                    steps.push(thinking_step);
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

                let call_step = AgentStep {
                    step_type: StepType::ToolCall,
                    content: format!("Calling: {}", tool_name),
                    tool_name: Some(tool_name.clone()),
                    tool_input: Some(tool_args.clone()),
                    tool_output: None,
                };
                let _ = step_tx.send(call_step.clone()).await;
                steps.push(call_step);

                let (step_type, result) = match self.execute_tool(tool_name, tool_args).await {
                    Ok(text) => (StepType::ToolResult, text),
                    Err(e) => {
                        warn!("Tool execution failed: {}", e);
                        (StepType::Error, format!("Error: {}", e))
                    }
                };

                let processed_result =
                    Self::handle_large_result(&self.config.workspace_dir, tool_name, &result).await;

                let result_step = AgentStep {
                    step_type,
                    content: processed_result.clone(),
                    tool_name: Some(tool_name.clone()),
                    tool_input: None,
                    tool_output: Some(processed_result.clone()),
                };
                let _ = step_tx.send(result_step.clone()).await;
                steps.push(result_step);
                messages.push(Message::tool_result(&tool_call.id, processed_result));
            }
        }

        let final_answer = steps
            .iter()
            .rev()
            .find(|s| matches!(s.step_type, StepType::Thinking | StepType::ToolResult))
            .map(|s| s.content.clone())
            .unwrap_or_else(|| "Task incomplete: iteration limit reached.".to_string());

        let final_step = AgentStep {
            step_type: StepType::FinalAnswer,
            content: final_answer.clone(),
            tool_name: None,
            tool_input: None,
            tool_output: None,
        };
        let _ = step_tx.send(final_step).await;

        Ok(AgentResponse {
            steps,
            final_answer,
            iterations,
        })
    }

}
