use tokio::sync::mpsc;
use crate::agent::AgentStep;

pub(crate) fn truncate_json(s: &str, max_chars: usize) -> &str {
    if s.len() <= max_chars {
        return s;
    }
    match s[..max_chars].rfind('\n') {
        Some(pos) => &s[..pos],
        None => &s[..max_chars],
    }
}

pub(crate) fn parse_econ_facts_json(text: &str) -> serde_json::Value {
    let empty = || serde_json::json!({
        "per_iteration": [], "price_quotes": [], "buys": [], "sells": [],
        "mints": [], "burns": [], "eth_transfers": [], "total_supply_reads": [],
        "suspicious_equalities": []
    });
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(text) {
        return json;
    }
    let cleaned = if let Some(s) = text.find("```json") {
        let after = &text[s + 7..];
        after[..after.find("```").unwrap_or(after.len())].trim()
    } else if let Some(s) = text.find("```") {
        let after = &text[s + 3..];
        after[..after.find("```").unwrap_or(after.len())].trim()
    } else {
        text
    };
    if let (Some(s), Some(e)) = (cleaned.find('{'), cleaned.rfind('}')) {
        serde_json::from_str(&cleaned[s..=e]).unwrap_or_else(|_| {
            tracing::warn!("Failed to parse economic facts JSON");
            empty()
        })
    } else {
        empty()
    }
}

pub(crate) fn local_tx() -> mpsc::Sender<AgentStep> {
    let (tx, _rx) = mpsc::channel(1);
    tx
}

pub(crate) async fn flush_steps(tx: &mpsc::Sender<AgentStep>, steps: &[AgentStep]) {
    for step in steps {
        let _ = tx.send(step.clone()).await;
    }
}

pub(crate) async fn send_step(
    tx: &mpsc::Sender<AgentStep>,
    steps: &mut Vec<AgentStep>,
    step: AgentStep,
) {
    let _ = tx.send(step.clone()).await;
    steps.push(step);
}
