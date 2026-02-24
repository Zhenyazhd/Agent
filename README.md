# llm-agent

A personal learning project — built to understand how LLM agents work under the hood and to get hands-on experience with Rust.

An LLM agent server written in Rust. Connects large language models (via [OpenRouter](https://openrouter.ai)) with external tools through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), and exposes everything over an HTTP API with real-time streaming. Comes with a React frontend.

## What it does

- Runs an LLM in a **ReAct loop** — the model reasons, calls tools, observes results, and repeats until it produces a final answer
- Connects to any number of **MCP servers** (filesystem, databases, blockchains, custom tools) over stdio or HTTP
- Streams agent steps to the client in real time over **SSE**
- Manages **context window automatically** — compacts conversation history with LLM summarization when approaching token limits
- Includes a specialized **Pipeline mode** for multi-pass blockchain transaction analysis (accepts multiple tx hashes, processes each sequentially)

## Quick start

```bash
# Backend
cp .env.example .env        # add your OPENROUTER_API_KEY
cargo run

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Backend starts on `http://localhost:3000`, frontend on `http://localhost:5173`.

## Configuration

All config is via environment variables (`.env` file supported).

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | — | **Required.** Your OpenRouter API key |
| `DEFAULT_MODEL` | `anthropic/claude-3.5-sonnet` | LLM model to use |
| `AGENT_MODE` | `free` | Initial mode: `free` (ReAct loop) or `pipeline` (tx analysis) |
| `SERVER_HOST` | `0.0.0.0` | HTTP server host |
| `SERVER_PORT` | `3000` | HTTP server port |
| `WORKSPACE_DIR` | `./WORKSPACE` | Directory for agent file output |
| `MAX_ITERATIONS` | `50` | Max ReAct loop iterations |
| `MAX_TOOL_RESULT_CHARS` | `100000` | Large tool outputs are saved to file instead |
| `MAX_PARALLEL_LLM_CALLS` | `4` | Concurrency limit for pipeline analysis passes |

## MCP servers

Configure MCP servers in `mcp_config.json` (see `mcp_config_example.json`):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "my-http-server": {
      "type": "streamable-http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

Environment variable substitution is supported: `"${MY_SECRET}"`.
Servers can be enabled/disabled at runtime via the API without restarting.

## API

### Agent

```
POST /v1/agent/run               — run agent, wait for full response
POST /v1/agent/run/stream        — run agent, stream steps as SSE
GET  /v1/agent/mode              — get current mode
POST /v1/agent/mode              — set mode: { "mode": "free" | "pipeline" }
GET  /v1/agent/tools             — list all available tools
```

**Run request body:**
```json
{
  "message": "List files in /tmp",
  "conversation": [],
  "model": "anthropic/claude-3.5-sonnet"
}
```

**Pipeline mode message format** — pass structured JSON as the `message` field:
```json
{
  "message": "{\"chain_id\":\"1\",\"tx_hashes\":[\"0xabc...\",\"0xdef...\"]}",
  "conversation": []
}
```
The agent runs the full 3-pass analysis for each transaction sequentially.

**Streaming response** — `text/event-stream`, each event:
```json
{
  "id": "uuid",
  "step": {
    "step_type": "thinking | tool_call | tool_result | final_answer | error",
    "content": "...",
    "tool_name": "mcp_server_toolname",
    "tool_input": "...",
    "tool_output": "..."
  },
  "done": false
}
```

### MCP

```
GET  /v1/mcp/servers             — list servers and their status
POST /v1/mcp/servers/enable      — { "server_name": "..." }
POST /v1/mcp/servers/disable     — { "server_name": "..." }
GET  /v1/mcp/tools               — list all available tools
POST /v1/mcp/call                — call a tool directly
```

### Other

```
GET  /health                     — health check
GET  /v1/models                  — list available models from OpenRouter
```

## Pipeline mode

Pipeline mode runs a specialized multi-pass analysis of blockchain transactions.

For each `tx_hash`, it:
1. **Decodes** the transaction via the `decode_tx` TypeScript pipeline (`npx tsx`)
   — trace decoding, ABI resolution, bytecode analysis, data enrichment
2. **Pass 1** (parallel) — compact flow analysis + economic facts extraction
3. **Pass 2** (parallel, semaphore-limited) — hypothesis generation, per-contract source analysis, per-phase deep dive, loop analysis
4. **Pass 3** — final synthesis into a markdown report

Results for each transaction are written to `WORKSPACE_DIR/<tx_hash>.md` and returned as the final answer.

## Project structure

```
agent/
├── src/                     # Rust backend
│   ├── main.rs              # Entry point: config, MCP init, Axum router
│   ├── config.rs            # Config struct (env vars → typed config)
│   ├── error.rs             # AgentError + Axum IntoResponse
│   ├── models.rs            # OpenAI-compatible types
│   ├── state.rs             # AppState shared across handlers
│   │
│   ├── agent/
│   │   ├── mod.rs           # Agent struct, run / run_stream, mode switching
│   │   ├── tools.rs         # MCP tool name encoding / execution
│   │   ├── history.rs       # Context compaction (trim + LLM summary)
│   │   ├── token_budget.rs  # Token tracking, model context window registry
│   │   ├── prompts.rs       # System prompts and prompt builders
│   │   ├── free/            # ReAct loop (executor, loop state, step sink)
│   │   └── pipeline/        # Transaction analysis pipeline
│   │       ├── mod.rs       # Entry point — iterates over tx hashes
│   │       ├── parser.rs    # JSON + regex extraction of chain_id / tx_hashes
│   │       ├── executor.rs  # TypeScript pipeline invocation (npx tsx)
│   │       └── passes/      # Pass 1, Pass 2, Pass 3 implementations
│   │
│   ├── handlers/            # Axum route handlers
│   ├── infrastructure/      # OpenRouterClient, large-file handler
│   └── mcp/                 # MCP protocol: JSON-RPC, stdio/HTTP transport
│
├── frontend/                # React + TypeScript UI
│   └── src/
│       ├── hooks/           # useChat (free mode), usePipeline (pipeline mode)
│       ├── components/      # ChatMessage, PipelineScreen, AgentStepsPanel, …
│       └── api/client.ts    # All backend communication
│
├── decode_tx/               # TypeScript tx decode pipeline (called by Pass 1)
├── mcp_solodit_db/          # MCP server: Solodit vulnerability DB
├── foundry-mcp-server/      # MCP server: Foundry (on-chain simulation)
├── servers/                 # Additional MCP servers
│
├── .env.example
├── mcp_config_example.json
└── Cargo.toml
```

## Dependencies

- **[axum](https://github.com/tokio-rs/axum)** — HTTP server and SSE
- **[tokio](https://tokio.rs)** — async runtime
- **[reqwest](https://github.com/seanmonstar/reqwest)** — HTTP client (OpenRouter + MCP HTTP transport)
- **[serde / serde_json](https://serde.rs)** — serialization
- **[tracing](https://github.com/tokio-rs/tracing)** — structured logging
- **[envy](https://github.com/softprops/envy)** — env vars → typed config struct
