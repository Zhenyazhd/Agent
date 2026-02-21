use crate::config::Config;
use tracing::info;

static MODEL_REGISTRY: &[(&str, u32)] = &[
    ("claude-2",       100_000),
    ("claude-3",       200_000),
    ("claude-sonnet",  200_000),
    ("claude-haiku",   200_000),
    ("claude-opus",    200_000),
    ("gpt-4o",         128_000),
    ("gpt-4-turbo",    128_000),
    ("gpt-4",            8_192),
    ("gpt-3.5",         16_385),
    ("llama-3.1",      128_000),
    ("llama-3.2",      128_000),
    ("llama-3.3",      128_000),
    ("llama-3",          8_192),
    ("gemini-1.5",   1_000_000),
    ("gemini-2",     1_000_000),
    ("gemini",          32_000),
    ("mixtral",         32_768),
    ("mistral",         32_768),
    ("deepseek",        64_000),
    ("qwen",            32_768),
];

const DEFAULT_CONTEXT_WINDOW: u32 = 32_000;

pub(super) fn model_context_window(model: &str) -> u32 {
    let m = model.to_lowercase();
    MODEL_REGISTRY.iter()
        .find(|(key, _)| m.contains(key))
        .map(|(_, ctx)| *ctx)
        .unwrap_or(DEFAULT_CONTEXT_WINDOW)
}

pub(super) fn effective_token_limits(model: &str, cfg: &Config) -> (u32, u32) {
    let ctx = model_context_window(model);
    let max = cfg.max_total_tokens.unwrap_or(ctx * 85 / 100);
    let compact = cfg.compact_threshold_tokens.unwrap_or(ctx * 60 / 100);
    let max = max.min(ctx);
    let compact = compact.min(max.saturating_sub(1));
    (max, compact)
}


pub(super) struct SessionBudget {
    pub last_prompt_tokens: u32,
    pub generated_tokens: u32,
    pub total_tool_chars: usize,
    pub max_prompt_tokens: u32,
    pub compact_threshold: u32,
    pub max_tool_output_chars: usize,
}

impl SessionBudget {
    pub fn new(max_prompt_tokens: u32, compact_threshold: u32, max_tool_output_chars: usize) -> Self {
        Self {
            last_prompt_tokens: 0,
            generated_tokens: 0,
            total_tool_chars: 0,
            max_prompt_tokens,
            compact_threshold,
            max_tool_output_chars,
        }
    }

    pub fn record_usage(&mut self, prompt_tokens: u32, completion_tokens: u32) -> bool {
        self.last_prompt_tokens = prompt_tokens;
        self.generated_tokens += completion_tokens;
        info!(
            "[TokenBudget] prompt={} (+completion={}) | window: {}/{} | generated_total: {}",
            prompt_tokens, completion_tokens,
            self.last_prompt_tokens, self.max_prompt_tokens,
            self.generated_tokens
        );
        self.last_prompt_tokens >= self.max_prompt_tokens
    }

    pub fn needs_compact(&self) -> bool {
        self.last_prompt_tokens >= self.compact_threshold
    }

    pub fn record_usage_fallback(&mut self, prompt_tokens_estimate: usize) -> bool {
        let est = prompt_tokens_estimate as u32;
        self.last_prompt_tokens = self.last_prompt_tokens.max(est);
        self.needs_compact()
    }

    pub fn add_tool_output(&mut self, chars: usize) -> bool {
        self.total_tool_chars += chars;
        self.total_tool_chars > self.max_tool_output_chars
    }
}
