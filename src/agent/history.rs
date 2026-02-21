use crate::models::{Message, Role};
use crate::infrastructure::openrouter::CompletionOptions;
use tracing::warn;
use super::Agent;

pub(super) fn estimate_history_tokens(messages: &[Message]) -> usize {
    messages.iter()
        .filter_map(|m| m.content.as_ref())
        .map(|c| c.chars().count() / 4)
        .sum()
}

fn last_n_turns_start(messages: &[Message], n: usize) -> usize {
    let positions: Vec<usize> = messages.iter().enumerate()
        .filter(|(_, m)| m.role == Role::Assistant)
        .map(|(i, _)| i)
        .collect();

    if positions.len() <= n {
        return messages.iter()
            .position(|m| m.role == Role::User)
            .map(|p| p + 1)
            .unwrap_or(2);
    }
    positions[positions.len() - n]
}

pub(super) fn compact_history_simple(messages: &[Message], keep_recent_turns: usize) -> Vec<Message> {
    let keep_from = last_n_turns_start(messages, keep_recent_turns);
    if keep_from <= 2 {
        return messages.to_vec();
    }

    let system = messages[0].clone();
    let first_user = messages.iter()
        .find(|m| m.role == Role::User)
        .cloned()
        .unwrap_or_else(|| messages[1].clone());

    let dropped = messages[2..keep_from].iter()
        .filter(|m| m.role == Role::Assistant)
        .count();

    let mut result = vec![
        system,
        first_user,
        Message::user(format!(
            "[CONTEXT COMPACTED: {} earlier turns omitted to reduce token usage]",
            dropped
        )),
    ];
    result.extend_from_slice(&messages[keep_from..]);
    result
}

pub(super) async fn compact_history_with_summary(
    agent: &Agent,
    messages: &[Message],
    model: &str,
    keep_recent_turns: usize,
) -> Vec<Message> {
    let keep_from = last_n_turns_start(messages, keep_recent_turns);
    if keep_from <= 2 {
        return messages.to_vec();
    }

    let conversation_text: String = messages[2..keep_from].iter()
        .filter_map(|m| {
            m.content.as_ref().map(|c| {
                let label = match m.role {
                    Role::Assistant => "Assistant",
                    Role::User => "User",
                    Role::Tool => "Tool",
                    Role::System => "System",
                };
                format!("[{}]: {}", label, c)
            })
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let summary_messages = vec![
        Message::system(
            "You are a concise summarizer. Output only the summary — no preamble or labels.",
        ),
        Message::user(format!(
            "Summarize the following conversation history concisely. \
             Preserve key findings, decisions, and context needed for continuation:\n\n{}",
            conversation_text
        )),
    ];

    let summary = match agent.client()
        .chat_completion(&summary_messages, CompletionOptions {
            model: Some(model),
            temperature: Some(0.0),
            max_tokens: Some(2000),
            ..Default::default()
        })
        .await
    {
        Ok(resp) => resp.choices.first()
            .and_then(|c| c.message.content.clone())
            .unwrap_or_default(),
        Err(e) => {
            warn!("[TokenBudget] summarization failed ({}), falling back to simple compaction", e);
            return compact_history_simple(messages, keep_recent_turns);
        }
    };

    let system = messages[0].clone();
    let first_user = messages.iter()
        .find(|m| m.role == Role::User)
        .cloned()
        .unwrap_or_else(|| messages[1].clone());

    let mut result = vec![
        system,
        first_user,
        Message::user(format!("[CONVERSATION SUMMARY]: {}", summary)),
    ];
    result.extend_from_slice(&messages[keep_from..]);
    result
}
