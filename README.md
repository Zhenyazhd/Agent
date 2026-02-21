# llm-agent

A personal learning project — built to understand how LLM agents work under the hood and to get hands-on experience with Rust.

An LLM agent server written in Rust. Connects large language models (via [OpenRouter](https://openrouter.ai)) with external tools through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), and exposes everything over an HTTP API with streaming support.

## What it does

- Runs an LLM in a **ReAct loop** — the model reasons, calls tools, observes results, and repeats until it produces a final answer
- Connects to any number of **MCP servers** (filesystem, databases, blockchains, custom tools) over stdio or HTTP
- Streams agent steps to the client in real time over **SSE**
- Manages **context window automatically** — compacts conversation history with LLM summarization when approaching token limits
- Includes a specialized **Pipeline mode** for multi-pass blockchain transaction analysis

## Quick start

```bash
cp .env.example .env
cargo run
```

Server starts on `http://localhost:3000`.

## Configuration

All config is via environment variables (`.env` file supported).

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | — | **Required.** Your OpenRouter API key |
| `DEFAULT_MODEL` | `anthropic/claude-3.5-sonnet` | LLM model to use |
| `AGENT_MODE` | `free` | `free` (ReAct loop) or `pipeline` (tx analysis) |
| `SERVER_HOST` | `0.0.0.0` | HTTP server host |
| `SERVER_PORT` | `3000` | HTTP server port |
| `WORKSPACE_DIR` | `./WORKSPACE` | Directory for agent file output |
| `MAX_ITERATIONS` | `50` | Max agent loop iterations |
| `MAX_TOOL_RESULT_CHARS` | `100000` | Large tool outputs are saved to file instead |
| `MAX_PARALLEL_LLM_CALLS` | `4` | Concurrency limit for pipeline mode |

## MCP servers

Configure MCP servers in `mcp_config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx -y @modelcontextprotocol/server-filesystem /path/to/dir"
    },
    "my-api": {
      "type": "streamable-http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

Environment variable substitution is supported: `"${MY_SECRET}"`.

## API

### Run agent (blocking)

```
POST /agent/run
```
```json
{
  "message": "List files in /tmp and summarize them",
  "conversation": [],
  "model": "anthropic/claude-3.5-sonnet"
}
```

### Run agent (streaming)

```
POST /agent/run/stream
```

Returns `text/event-stream`. Each event contains an `AgentStep` with `step_type` (`Thinking`, `ToolCall`, `ToolResult`, `FinalAnswer`, `Error`) and `done: true` on the last event.

### MCP endpoints

```
GET  /mcp/tools              — list all available tools
GET  /mcp/servers            — list servers and their status
POST /mcp/tools/call         — call a tool directly
POST /mcp/servers/enable     — enable a server at runtime
POST /mcp/servers/disable    — disable a server at runtime
```

## Project structure

```
src/
├── main.rs              # Entry point: config, MCP init, Axum server
├── config.rs            # Config struct (loaded from env vars)
├── error.rs             # AgentError enum + Axum IntoResponse impl
├── models.rs            # OpenAI-compatible types (Message, Tool, ToolCall, …)
├── state.rs             # AppState — shared state passed to every handler
│
├── agent/
│   ├── mod.rs           # Agent struct, AgentStep, StepType
│   ├── tools.rs         # MCP tool name encoding; get_tools / execute_tool
│   ├── history.rs       # History compaction (simple trim + LLM summarization)
│   ├── token_budget.rs  # Token tracking and model context window registry
│   ├── prompts.rs       # All system prompts and prompt builder functions
│   ├── free/            # ReAct loop implementation
│   └── pipeline/        # Multi-pass blockchain transaction analysis
│       └── passes/      # Pass 1 (parallel facts), Pass 2 (parallel analysis), Pass 3 (synthesis)
│
├── handlers/            # Axum route handlers (thin wrappers over Agent / McpManager)
├── infrastructure/      # OpenRouterClient, file_handler (large output to disk)
└── mcp/                 # MCP protocol: transport (stdio/HTTP), manager, JSON-RPC
```

## Dependencies

- **[axum](https://github.com/tokio-rs/axum)** — HTTP server
- **[tokio](https://tokio.rs)** — async runtime
- **[reqwest](https://github.com/seanmonstar/reqwest)** — HTTP client (OpenRouter + MCP HTTP transport)
- **[serde / serde_json](https://serde.rs)** — serialization
- **[tracing](https://github.com/tokio-rs/tracing)** — structured logging
