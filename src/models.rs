use serde::{Deserialize, Serialize};


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Tool calls made by assistant (for assistant messages)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<MessageToolCall>>,
    /// Tool call ID this message is responding to (for tool messages)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// Tool call in a message (simplified version for sending)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: MessageFunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageFunctionCall {
    pub name: String,
    pub arguments: String,
}

impl Message {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            content: Some(content.into()),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: Some(content.into()),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: Some(content.into()),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn assistant_with_tool_calls(content: Option<String>, tool_calls: Vec<MessageToolCall>) -> Self {
        Self {
            role: Role::Assistant,
            content,
            name: None,
            tool_calls: Some(tool_calls),
            tool_call_id: None,
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: Role::Tool,
            content: Some(content.into()),
            name: None,
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionDefinition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Request to OpenRouter API
#[derive(Debug, Serialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<Message>,
    /// Температура генерации (0.0-2.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    /// Максимальное количество токенов в ответе
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    /// Включить streaming ответ (Server-Sent Events)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    /// Доступные инструменты (функции) для вызова
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Tool>>,
    /// Top-p (nucleus sampling) параметр
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    /// Штраф за частоту токенов
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f32>,
    /// Штраф за присутствие токенов
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f32>,
}

/// Response from OpenRouter API
#[derive(Debug, Deserialize)]
pub struct ChatCompletionResponse {
    /// Уникальный идентификатор запроса
    pub id: String,
    /// Список вариантов ответов (обычно один)
    pub choices: Vec<Choice>,
    /// Имя модели, которая сгенерировала ответ
    pub model: String,
    /// Информация об использовании токенов (опционально)
    pub usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
pub struct Choice {
    pub index: u32,
    pub message: ResponseMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResponseMessage {
    pub role: String,
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// Streaming response chunk
#[derive(Debug, Deserialize)]
pub struct ChatCompletionChunk {
    pub id: String,
    pub choices: Vec<StreamChoice>,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StreamChoice {
    pub index: u32,
    pub delta: Delta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Delta {
    pub role: Option<String>,
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCallDelta>>,
}

#[derive(Debug, Deserialize)]
pub struct ToolCallDelta {
    pub index: u32,
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub call_type: Option<String>,
    pub function: Option<FunctionCallDelta>,
}

#[derive(Debug, Deserialize)]
pub struct FunctionCallDelta {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

/// API request from client
#[derive(Debug, Deserialize)]
pub struct AgentRequest {
    pub messages: Vec<Message>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub stream: Option<bool>,
    #[serde(default)]
    pub system_prompt: Option<String>,
}

/// API response to client
#[derive(Debug, Serialize)]
pub struct AgentResponse {
    pub id: String,
    pub content: String,
    pub model: String,
    pub usage: Option<UsageInfo>,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UsageInfo {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// Error response
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}
