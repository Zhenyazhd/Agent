use crate::config::Config;
use crate::error::AgentError;
use crate::models::{ChatCompletionRequest, ChatCompletionResponse, Message, Tool};
use reqwest::Client;
use tracing::{debug, error, info};

pub(crate) struct CompletionOptions<'a> {
    pub model: Option<&'a str>,
    pub tools: Option<&'a [Tool]>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

impl Default for CompletionOptions<'_> {
    fn default() -> Self {
        Self { model: None, tools: None, temperature: None, max_tokens: None }
    }
}

fn truncate_str(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

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

    async fn send_request(
        &self,
        request: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, AgentError> {
        info!("Sending request to model: {}", request.model);
        debug!("Request: {:?}", request);

        let response = self
            .client
            .post(format!("{}/chat/completions", self.config.openrouter_base_url))
            .header("Authorization", format!("Bearer {}", self.config.openrouter_api_key))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/anthropics/claude-code")
            .header("X-Title", "LLM Agent")
            .json(&request)
            .send()
            .await
            .map_err(|e| AgentError::RequestFailed(e))?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            error!("OpenRouter API error: {} - {}", status, error_text);
            return Err(AgentError::ApiError {
                status: status.as_u16(),
                message: error_text,
            });
        }

        let response_text = response
            .text()
            .await
            .map_err(|e| AgentError::Internal(format!("Failed to get response text: {}", e)))?;

        debug!("Raw API response: {}", truncate_str(&response_text, 2000));

        let completion: ChatCompletionResponse = serde_json::from_str(&response_text)
            .map_err(|e| {
                error!("Failed to parse response: {}. Response: {}", e, truncate_str(&response_text, 500));
                AgentError::Internal(format!("JSON parse error: {}. Response preview: {}", e, truncate_str(&response_text, 200)))
            })?;

        info!("Received response with {} choices", completion.choices.len());
        Ok(completion)
    }

    pub(crate) async fn chat_completion(
        &self,
        messages: &[Message],
        opts: CompletionOptions<'_>,
    ) -> Result<ChatCompletionResponse, AgentError> {
        let request = ChatCompletionRequest {
            model: opts.model.unwrap_or(&self.config.default_model).to_string(),
            messages: messages.to_vec(),
            temperature: opts.temperature,
            max_tokens: opts.max_tokens,
            stream: Some(false),
            tools: opts.tools.map(|t| t.to_vec()),
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
        };

        self.send_request(request).await
    }

    pub async fn list_models(&self) -> Result<serde_json::Value, AgentError> {
        let response = self
            .client
            .get(format!("{}/models", self.config.openrouter_base_url))
            .header("Authorization", format!("Bearer {}", self.config.openrouter_api_key))
            .send()
            .await
            .map_err(|e| AgentError::RequestFailed(e))?;

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
            .map_err(|e| AgentError::RequestFailed(e))
    }
}
