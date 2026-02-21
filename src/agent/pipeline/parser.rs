
pub fn extract_tx_params(message: &str) -> Option<(String, u64)> {
    let tx_hash = if let Some(pos) = message.find("0x") {
        let rest = &message[pos + 2..];
        if rest.len() >= 64 && rest.chars().take(64).all(|c| c.is_ascii_hexdigit()) {
            format!("0x{}", &rest[..64])
        } else {
            return None;
        }
    } else {
        return None;
    };

    let lower = message.to_lowercase();
    let chain_id = if let Some(pos) = lower.find("chainid") {
        let after = &lower[pos + 7..];
        let num_str = after
            .trim_start_matches([':', ' ', '='])
            .split_whitespace()
            .next()?;
        num_str.parse().ok()
    } else if let Some(pos) = lower.find("chain_id") {
        let after = &lower[pos + 8..];
        let num_str = after
            .trim_start_matches([':', ' ', '='])
            .split_whitespace()
            .next()?;
        num_str.parse().ok()
    } else if let Some(pos) = lower.find("chain:") {
        let after = &lower[pos + 6..];
        let num_str = after.trim().split_whitespace().next()?;
        num_str.parse().ok()
    } else {
        lower
            .split_whitespace()
            .find_map(|word| {
                word.parse::<u64>().ok().and_then(|n| {
                    if matches!(n, 1 | 137 | 42161 | 10 | 8453 | 56 | 43114 | 11155111 | 5 | 80001) {
                        Some(n)
                    } else {
                        None
                    }
                })
            })
            .or_else(|| {
                if lower.contains("polygon") {
                    Some(137)
                } else if lower.contains("arbitrum") {
                    Some(42161)
                } else if lower.contains("optimism") {
                    Some(10)
                } else if lower.contains("base") {
                    Some(8453)
                } else if lower.contains("bsc") || lower.contains("binance") {
                    Some(56)
                } else if lower.contains("avalanche") || lower.contains("avax") {
                    Some(43114)
                } else if lower.contains("sepolia") {
                    Some(11155111)
                } else if lower.contains("mumbai") {
                    Some(80001)
                } else {
                    Some(1)
                }
            })
    };

    chain_id.map(|cid| (tx_hash, cid))
}

