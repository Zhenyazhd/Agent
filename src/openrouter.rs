use crate::config::Config;
use crate::error::AgentError;
use crate::models::{ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, Message, Tool};
use crate::tools::ToolDefinition;
use futures::StreamExt;
use reqwest::Client;
use tokio::sync::mpsc;
use tracing::{debug, error, info};

/// OpenRouter API client
#[derive(Clone)]
pub struct OpenRouterClient {
    client: Client,
    config: Config,
}

impl OpenRouterClient {
    pub fn new(config: Config) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to create HTTP client");

        Self { client, config }
    }

    /// Send a chat completion request (non-streaming)
    pub async fn chat_completion(
        &self,
        messages: Vec<Message>,
        model: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    ) -> Result<ChatCompletionResponse, AgentError> {
        let model = model.unwrap_or_else(|| self.config.default_model.clone());

        let request = ChatCompletionRequest {
            model: model.clone(),
            messages,
            temperature,
            max_tokens,
            stream: Some(false),
            tools: None,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
        };

        info!("Sending chat completion request to model: {}", model);
        debug!("Request: {:?}", request);

        let response = self
            .client
            .post(format!("{}/chat/completions", self.config.openrouter_base_url))
            .header("Authorization", format!("Bearer {}", self.config.openrouter_api_key))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/your-app")  // Референс для OpenRouter
            .header("X-Title", "LLM Agent")                          // Название приложения
            .json(&request)  // Сериализуем запрос в JSON
            .send()
            .await
            .map_err(|e| AgentError::RequestFailed(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            error!("OpenRouter API error: {} - {}", status, error_text);
            return Err(AgentError::ApiError {
                status: status.as_u16(),
                message: error_text,
            });
        }

        let completion: ChatCompletionResponse = response
            .json()
            .await
            .map_err(|e| AgentError::ParseError(e.to_string()))?;

        info!("Received response with {} choices", completion.choices.len());
        Ok(completion)
    }

    /// Send a streaming chat completion request
    pub async fn chat_completion_stream(
        &self,
        messages: Vec<Message>,
        model: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    ) -> Result<mpsc::Receiver<Result<ChatCompletionChunk, AgentError>>, AgentError> {
        let model = model.unwrap_or_else(|| self.config.default_model.clone());

        let request = ChatCompletionRequest {
            model: model.clone(),
            messages,
            temperature,
            max_tokens,
            stream: Some(true),
            tools: None,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
        };

        info!("Sending streaming chat completion request to model: {}", model);

        let response = self
            .client
            .post(format!("{}/chat/completions", self.config.openrouter_base_url))
            .header("Authorization", format!("Bearer {}", self.config.openrouter_api_key))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/your-app")
            .header("X-Title", "LLM Agent")
            .json(&request)
            .send()
            .await
            .map_err(|e| AgentError::RequestFailed(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            error!("OpenRouter API error: {} - {}", status, error_text);
            return Err(AgentError::ApiError {
                status: status.as_u16(),
                message: error_text,
            });
        }

        let (tx, rx) = mpsc::channel(100);
        let mut stream = response.bytes_stream();

        tokio::spawn(async move {
            let mut buffer = String::new();  // Буфер для накопления неполных SSE событий

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));

                        // Process complete SSE events
                        while let Some(pos) = buffer.find("\n\n") {
                            let event = buffer[..pos].to_string();
                            buffer = buffer[pos + 2..].to_string();

                            if event.starts_with("data: ") {
                                let data = &event[6..];
                                if data == "[DONE]" {
                                    debug!("Stream completed");
                                    return;
                                }

                                match serde_json::from_str::<ChatCompletionChunk>(data) {
                                    Ok(chunk) => {
                                        if tx.send(Ok(chunk)).await.is_err() {
                                            return;
                                        }
                                    }
                                    Err(e) => {
                                        debug!("Failed to parse chunk: {} - data: {}", e, data);
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(AgentError::StreamError(e.to_string()))).await;
                        return;
                    }
                }
            }
        });

        Ok(rx)
    }

    /// List available models from OpenRouter
    pub async fn list_models(&self) -> Result<serde_json::Value, AgentError> {
        let response = self
            .client
            .get(format!("{}/models", self.config.openrouter_base_url))
            .header("Authorization", format!("Bearer {}", self.config.openrouter_api_key))
            .send()
            .await
            .map_err(|e| AgentError::RequestFailed(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AgentError::ApiError {
                status: status.as_u16(),
                message: error_text,
            });
        }

        response
            .json()
            .await
            .map_err(|e| AgentError::ParseError(e.to_string()))
    }

    /// Send a chat completion request with tools (for agent mode)
    pub async fn chat_completion_with_tools(
        &self,
        messages: Vec<Message>,
        model: Option<String>,
        tools: Option<Vec<ToolDefinition>>,
    ) -> Result<ChatCompletionResponse, AgentError> {
        let model = model.unwrap_or_else(|| self.config.default_model.clone());

        // Convert ToolDefinition to Tool format
        let tools: Option<Vec<Tool>> = tools.map(|t| {
            t.into_iter()
                .map(|td| Tool {
                    tool_type: td.tool_type,
                    function: crate::models::FunctionDefinition {
                        name: td.function.name,
                        description: td.function.description,
                        parameters: td.function.parameters,
                    },
                })
                .collect()
        });

        let request = ChatCompletionRequest {
            model: model.clone(),
            messages,
            temperature: Some(0.7),
            max_tokens: Some(1024),
            stream: Some(false),
            tools,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
        };

        info!("Sending chat completion with tools to model: {}", model);
        debug!("Request: {:?}", request);

        let response = self
            .client
            .post(format!("{}/chat/completions", self.config.openrouter_base_url))
            .header("Authorization", format!("Bearer {}", self.config.openrouter_api_key))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/your-app")
            .header("X-Title", "LLM Agent")
            .json(&request)
            .send()
            .await
            .map_err(|e| AgentError::RequestFailed(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            error!("OpenRouter API error: {} - {}", status, error_text);
            return Err(AgentError::ApiError {
                status: status.as_u16(),
                message: error_text,
            });
        }

        let completion: ChatCompletionResponse = response
            .json()
            .await
            .map_err(|e| AgentError::ParseError(e.to_string()))?;

        info!("Received response with {} choices", completion.choices.len());
        Ok(completion)
    }
}
