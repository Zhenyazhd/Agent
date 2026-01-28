use crate::config::Config;
use crate::error::AgentError;
use crate::models::{Message, MessageToolCall, MessageFunctionCall};
use crate::openrouter::OpenRouterClient;
use crate::tools::{ToolDefinition, ToolRegistry};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

const MAX_ITERATIONS: usize = 10;

/// Agent that can use tools to accomplish tasks
pub struct Agent {
    client: OpenRouterClient,
    tools: ToolRegistry,
    config: Config,
}

/// A single step in the agent's execution
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

/// Complete agent response with all steps
#[derive(Debug, Clone, Serialize)]
pub struct AgentResponse {
    pub steps: Vec<AgentStep>,
    pub final_answer: String,
    pub iterations: usize,
}

impl Agent {
    pub fn new(config: Config) -> Self {
        Self {
            client: OpenRouterClient::new(config.clone()),
            tools: ToolRegistry::new(),
            config,
        }
    }

    pub fn get_tools(&self) -> Vec<ToolDefinition> {
        self.tools.get_all()
    }

    /// Run the agent with a user message
    pub async fn run(
        &self,
        user_message: &str,
        conversation_history: Vec<Message>,
        system_prompt: Option<String>,
        model: Option<String>,
    ) -> Result<AgentResponse, AgentError> {
        let system_prompt = system_prompt.unwrap_or_else(|| {
            r#"You are a helpful AI assistant with access to tools.
When you need to perform calculations, get current time, search for information, or execute code, use the available tools.
Always explain your reasoning before using a tool.
After getting tool results, analyze them and provide a helpful response to the user."#.to_string()
        });

        let mut messages = vec![Message::system(&system_prompt)];
        messages.extend(conversation_history);
        messages.push(Message::user(user_message));

        let tools = self.get_tools();
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

            // Call LLM with tools
            let response = self
                .client
                .chat_completion_with_tools(messages.clone(), Some(model.clone()), Some(tools.clone()))
                .await?;

            let choice = response
                .choices
                .first()
                .ok_or_else(|| AgentError::ParseError("No choices in response".to_string()))?;

            // Check if there are tool calls
            if let Some(tool_calls) = &choice.message.tool_calls {
                if !tool_calls.is_empty() {
                    // Process each tool call
                    let assistant_content = choice.message.content.clone();

                    if let Some(ref content) = assistant_content {
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

                    // Convert tool calls to message format
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

                    // Add assistant message with tool calls to history
                    messages.push(Message::assistant_with_tool_calls(
                        assistant_content,
                        message_tool_calls,
                    ));

                    // Execute each tool and add results
                    for tool_call in tool_calls {
                        let tool_name = &tool_call.function.name;
                        let tool_args = &tool_call.function.arguments;

                        steps.push(AgentStep {
                            step_type: StepType::ToolCall,
                            content: format!("Calling tool: {}", tool_name),
                            tool_name: Some(tool_name.clone()),
                            tool_input: Some(tool_args.clone()),
                            tool_output: None,
                        });

                        // Execute the tool
                        let result = self.tools.execute(tool_name, tool_args).await;

                        steps.push(AgentStep {
                            step_type: StepType::ToolResult,
                            content: result.result.clone(),
                            tool_name: Some(tool_name.clone()),
                            tool_input: None,
                            tool_output: Some(result.result.clone()),
                        });

                        // Add tool result to messages
                        messages.push(Message::tool_result(&tool_call.id, result.result));
                    }

                    continue; // Continue the loop to get next response
                }
            }

            // No tool calls - this is the final answer
            let final_answer = choice.message.content.clone().unwrap_or_default();

            steps.push(AgentStep {
                step_type: StepType::FinalAnswer,
                content: final_answer.clone(),
                tool_name: None,
                tool_input: None,
                tool_output: None,
            });

            return Ok(AgentResponse {
                steps,
                final_answer,
                iterations,
            });
        }

        // If we broke out of the loop due to max iterations
        let final_answer = steps
            .iter()
            .filter(|s| s.step_type == StepType::Thinking || s.step_type == StepType::ToolResult)
            .last()
            .map(|s| s.content.clone())
            .unwrap_or_else(|| "I couldn't complete the task within the iteration limit.".to_string());

        Ok(AgentResponse {
            steps,
            final_answer,
            iterations,
        })
    }
}
