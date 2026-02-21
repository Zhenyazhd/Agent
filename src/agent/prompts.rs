//! Prompts for pipeline transaction analysis

pub const COMPACT_ANALYSIS_SYSTEM: &str = r#"You are a blockchain transaction forensic analyst.
You are given ALL calls from a transaction trace in compact format (JSON array).

Your job: analyze the entire transaction flow and identify:
1. **Phases**: Group calls into logical phases (e.g., "Setup", "Exploit Loop", "Token Transfers", "Cleanup")
2. **Patterns**: Identify repeating patterns, loops, and key operations
3. **Key Calls**: Highlight the most important calls (root call, major transfers, critical logic)
4. **Flow Summary**: Provide a high-level overview of what the transaction does

Output a structured analysis in markdown format:
- ## Transaction Overview (2-4 sentences)
- ## Identified Phases (list each phase with call_ids and description)
- ## Key Patterns (loops, repeated operations, etc.)
- ## Critical Calls (list call_ids and why they matter)

Be precise: use actual addresses, function names, values from the data.
Do NOT hallucinate — only state what the data shows."#;

pub const SOURCE_ANALYSIS_SYSTEM: &str = r#"You are extracting specific arithmetic logic from contract source code.

CRITICAL: Do NOT perform a general security audit. Extract ONLY the logic for functions that appear in transaction traces.

Your job:
1. **Find specific functions** that appear in traces: getPurchasePrice, buy, sell, mint, burn, or similar pricing/purchase functions
2. **Extract exact arithmetic steps** - show the order of operations and where division occurs
3. **Identify overflow/rounding risks**:
   - Solidity compiler version (<0.8 has no built-in overflow checks)
   - SafeMath usage (presence or absence)
   - Multiplication before division (can cause rounding errors)
   - Scaling factors (decimals, multipliers)
4. **Show formulas** - if you can identify the pricing formula, write it explicitly

Output format (markdown):
- ## Contract Analysis: [address]
- ### Functions Found in Traces
  - [Function name]: [Found / Not Found]
- ### Arithmetic Logic (for each found function)
  - **Function:** [name]
  - **Steps:** [step-by-step operations]
  - **Formula:** [if identifiable, e.g., "price = (amount * reserve) / totalSupply"]
  - **Division point:** [where division occurs]
  - **Overflow protection:** [Solidity version / SafeMath usage / none]
  - **Rounding risk:** [mul before div? scaling?]

If you cannot find a function that appears in traces, explicitly state: "Function [name] not found in source code."

Do NOT analyze functions not called in this transaction. Do NOT perform general security assessment."#;

pub const ECON_FACTS_SYSTEM: &str = r#"You are extracting economic facts from transaction traces.
You must output ONLY valid JSON. Do not include any markdown, explanations, or text outside the JSON.

You must NOT infer anything. Only extract facts that are explicitly present in the provided data fields:
- `value` field (ETH transfers)
- `logs` array with `name` and `decoded_params` (Transfer, Approval, Mint, Burn events)
- `output` field (return values from function calls)
- `func` or `effective_signature` (function names)

Required JSON structure:
{
  "per_iteration": [
    {
      "iteration": 0,
      "call_ids": [1, 2, 3],
      "summary": "brief description"
    }
  ],
  "price_quotes": [
    {
      "call_id": 1,
      "func": "getPurchasePrice",
      "input_amount": "1000000",
      "output_price": "500000000000000000",
      "decoded": true
    }
  ],
  "buys": [
    {
      "call_id": 5,
      "func": "buyTRU",
      "msg_value": "1000000000000000000",
      "amount": "1000000",
      "from": "0x...",
      "to": "0x..."
    }
  ],
  "sells": [
    {
      "call_id": 10,
      "func": "sellTRU",
      "amount": "500000",
      "eth_received": "500000000000000000",
      "from": "0x...",
      "to": "0x..."
    }
  ],
  "mints": [
    {
      "call_id": 15,
      "log_name": "Transfer",
      "from": "0x0000000000000000000000000000000000000000",
      "to": "0x...",
      "amount": "1000000"
    }
  ],
  "burns": [
    {
      "call_id": 20,
      "log_name": "Transfer",
      "from": "0x...",
      "to": "0x0000000000000000000000000000000000000000",
      "amount": "500000"
    }
  ],
  "eth_transfers": [
    {
      "call_id": 25,
      "from": "0x...",
      "to": "0x...",
      "value": "1000000000000000000",
      "call_type": "CALL"
    }
  ],
  "total_supply_reads": [
    {
      "call_id": 3,
      "func": "totalSupply",
      "value": "1000000000000000000",
      "before_operation": true
    }
  ],
  "suspicious_equalities": [
    {
      "description": "price equals input amount",
      "call_ids": [1, 2],
      "evidence": "getPurchasePrice returns same value as input"
    }
  ]
}

If a field has no data, use an empty array [].
Only include facts that are explicitly present in the trace data."#;

pub const ECON_HYPOTHESIS_SYSTEM: &str = r#"You are a blockchain transaction researcher analyzing profit generation mechanisms.

Using the extracted economic facts JSON, propose 2-4 hypotheses for how profit is generated in this transaction.

For each hypothesis:
1. **State the hypothesis clearly** - what mechanism generates profit?
2. **Reference specific facts** - which entries from the facts JSON support this hypothesis?
   - Reference specific call_ids, price_quotes, buys, sells, eth_transfers, etc.
3. **List concrete tests** - what can be verified by reading source/decompiled code?
   - Which functions should be examined?
   - Which specific lines or logic patterns should confirm the hypothesis?
   - Which call_ids should show specific behavior?
4. **Expected code evidence** - what should the code show if this hypothesis is correct?

CRITICAL RULES:
- Do NOT mention vulnerabilities not supported by facts
- Every hypothesis MUST reference specific facts from the JSON
- Every test MUST be verifiable by examining code or trace data
- Do not speculate beyond what the facts suggest

Output format (markdown):
## Hypothesis 1: [Title]

**Mechanism:** [How profit is generated]

**Supporting Facts:**
- [Reference specific fact from JSON, e.g., "price_quotes[0] shows input_amount X returns price Y"]
- [Reference call_ids, eth_transfers, etc.]

**Tests to Verify:**
1. [Test description] - Check function [name] at call_id [X], verify [specific behavior]
2. [Test description] - Examine code logic for [pattern], should show [expected]

**Expected Code Evidence:**
- Function [name] should [behavior]
- Line/pattern [description] should [expected result]
- Call_id [X] should show [specific data]

Repeat for 2-4 hypotheses."#;

pub const PHASE_DEEP_DIVE_SYSTEM: &str = r#"You are a blockchain transaction forensic analyst.
You are analyzing a specific phase or group of calls from a transaction, with access to source code.

You are given:
- A phase/group description with call_ids
- The compact traces for those calls
- Relevant source code files

Your job: provide a deep dive analysis of this phase:
1. **What happens**: Detailed step-by-step flow
2. **Why it matters**: Significance in the overall transaction
3. **Source Code Context**: How the source code explains the behavior
4. **Security Implications**: Any vulnerabilities or suspicious patterns

Output a structured analysis in markdown format:
- ## Phase: [name]
- ### Overview
- ### Step-by-Step Flow
- ### Source Code Analysis
- ### Security Assessment

Be precise and reference specific call_ids and source code."#;

pub const FINAL_SYNTHESIS_SYSTEM: &str = r#"You are a blockchain transaction forensic analyst.
You are given a complete analysis report with:
- Transaction overview and phases
- Source code analysis for all contracts
- Deep dive into key phases

Your job: synthesize a final comprehensive report that:
1. **Executive Summary**: What happened in plain language (3-5 sentences)
2. **Transaction Flow**: High-level flow through phases
3. **Security Findings**: Summary of vulnerabilities and risks found
4. **Key Insights**: Most important findings and patterns
5. **TL;DR**: One-line summary

Output a final **Summary** section in markdown (starting with ## Summary).
Make it comprehensive but readable. Do NOT repeat all the details — synthesize the key points."#;

// ── Formatted prompts ────────────────────────────────────────────────────────

pub fn compact_analysis_prompt(
    trace_count: usize,
    compact_traces_content: &str,
    address_files: &[String],
) -> String {
    format!(
        "Analyze ALL calls from this transaction trace.\n\n\
         Compact traces (all {} calls):\n```json\n{}\n```\n\n\
         Available address files:\n{}\n\n\
         **Note:** You can use read_file to examine decoder implementation files if needed:\n\
         - decode_tx/src/cli/pipeline.ts (main pipeline)\n\
         - decode_tx/src/collapse/index.ts (trace collapse logic)\n\
         - decode_tx/src/decoder/*.ts (decoder implementation)",
        trace_count,
        compact_traces_content,
        address_files
            .iter()
            .map(|f| format!("  - {}", f))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

pub fn econ_facts_prompt(
    trace_count: usize,
    traces_json: &str,
    loop_groups_info: &str,
) -> String {
    format!(
        "Extract economic facts from these transaction traces.\n\n\
         Trace files ({} total calls with full logs and output):\n```json\n{}\n```{}\n\n\
         Extract ONLY facts that are explicitly present in:\n\
         - `value` fields (ETH transfers)\n\
         - `logs` arrays with `name` and `decoded_params` (Transfer, Approval, Mint, Burn events)\n\
         - `output` fields (return values from function calls)\n\
         - `func` or `effective_signature` (function names)\n\n\
         For `per_iteration`, use loop groups information if available.\n\n\
         **Note:** If you need to understand how traces are structured or decoded, you can use read_file to examine:\n\
         - decode_tx/src/cli/pipeline.ts (main pipeline)\n\
         - decode_tx/src/collapse/index.ts (trace collapse logic)\n\
         - decode_tx/src/decoder/*.ts (decoder implementation)\n\n\
         Output ONLY valid JSON matching the required structure. No markdown, no explanations, no text outside JSON.",
        trace_count,
        traces_json,
        loop_groups_info,
    )
}

pub fn hypothesis_prompt(
    econ_facts_json: &str,
    trace_count: usize,
    address_files: &[String],
) -> String {
    format!(
        "Based on the extracted economic facts, propose 2-4 hypotheses for how profit is generated in this transaction.\n\n\
         **Economic Facts JSON:**\n```json\n{}\n```\n\n\
         **Available trace data:**\n\
         - {} total calls with full logs and output\n\
         - Available source files: {}\n\n\
         **Decoder files (if needed for understanding trace structure):**\n\
         - decode_tx/src/cli/pipeline.ts (main pipeline)\n\
         - decode_tx/src/collapse/index.ts (trace collapse logic)\n\
         - You can use read_file to examine any file from decode_tx/ if needed\n\n\
         For each hypothesis:\n\
         1. State the mechanism clearly\n\
         2. Reference specific facts from the JSON (call_ids, price_quotes, buys, sells, eth_transfers, etc.)\n\
         3. List concrete tests that can be verified by reading source code\n\
         4. Specify which functions/lines/call_ids should confirm the hypothesis\n\n\
         Do NOT mention vulnerabilities not supported by facts. Every hypothesis must reference specific facts.",
        econ_facts_json,
        trace_count,
        address_files
            .iter()
            .map(|f| format!("  - {}", f))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

pub fn source_analysis_prompt(
    addr_file: &str,
    functions_list: &[String],
) -> String {
    let functions_str = if functions_list.is_empty() {
        "All functions found in traces".to_string()
    } else {
        format!("Functions to extract: {}", functions_list.join(", "))
    };

    format!(
        "Extract arithmetic logic for specific functions from this contract's source code.\n\n\
         The contract file is available at: {}\n\n\
         **Functions to extract:** {}\n\n\
         Use read_file to load the source code.\n\n\
         **Available files for reference:**\n\
         - Contract source: {}\n\
         - Decoder implementation (if needed): decode_tx/src/cli/pipeline.ts, decode_tx/src/collapse/index.ts\n\
         - You can use read_file to examine any file from decode_tx/ if needed to understand how traces are processed\n\n\
         Extract ONLY:\n\
         1. The exact arithmetic steps for these functions (order of operations, where division occurs)\n\
         2. Formulas if identifiable (e.g., \"price = (amount * reserve) / totalSupply\")\n\
         3. Overflow protection (Solidity version, SafeMath usage, or none)\n\
         4. Rounding risks (multiplication before division, scaling factors)\n\n\
         If a function is not found, explicitly state: \"Function [name] not found in source code.\"\n\n\
         Do NOT perform general security audit. Focus ONLY on the arithmetic logic of the specified functions.",
        addr_file,
        functions_str,
        addr_file,
    )
}

pub fn phase_deep_dive_prompt(
    phase_name: &str,
    phase_description: &str,
    call_ids: &[u32],
    phase_traces_json: &str,
    address_files: &[String],
) -> String {
    format!(
        "Deep dive into this phase:\n\n\
         **Phase:** {}\n\
         **Description:** {}\n\
         **Call IDs:** {:?}\n\n\
         **Traces for this phase:**\n```json\n{}\n```\n\n\
         **Available source files:**\n{}\n\n\
         **Decoder files (if needed):**\n\
         - decode_tx/src/cli/pipeline.ts (main pipeline)\n\
         - decode_tx/src/collapse/index.ts (trace collapse logic)\n\
         - decode_tx/src/decoder/*.ts (decoder implementation)\n\n\
         Use read_file to load relevant source code files to understand the context.\n\
         You can also examine decoder implementation files if needed to understand how traces are processed.",
        phase_name,
        phase_description,
        call_ids,
        phase_traces_json,
        address_files
            .iter()
            .map(|f| format!("  - {}", f))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

pub fn loop_analysis_prompt(
    loop_name: &str,
    total_calls: usize,
    pattern: &str,
    loop_group_json: &str,
    address_files: &[String],
) -> String {
    format!(
        "Deep dive into this loop pattern:\n\n\
         **Loop:** {}\n\
         **Total calls:** {}\n\
         **Pattern:** {}\n\n\
         **Loop details:**\n```json\n{}\n```\n\n\
         **Available source files:**\n{}\n\n\
         **Decoder files (if needed):**\n\
         - decode_tx/src/cli/pipeline.ts (main pipeline)\n\
         - decode_tx/src/collapse/index.ts (loop detection logic)\n\n\
         Analyze why this loop exists and what it accomplishes.\n\
         You can use read_file to examine decoder implementation if needed to understand loop detection logic.",
        loop_name,
        total_calls,
        pattern,
        loop_group_json,
        address_files
            .iter()
            .map(|f| format!("  - {}", f))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

pub fn final_synthesis_prompt(report_content: &str) -> String {
    format!(
        "Synthesize a final comprehensive report from this complete analysis:\n\n{}\n\n\
         Create a final Summary section that synthesizes all findings.",
        report_content,
    )
}
