# LLM Agent — Frontend

React + TypeScript UI for the [LLM Agent](../README.md) backend. Supports two modes switchable at runtime without losing state.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Requires the backend running at `http://localhost:3000` (or configure `VITE_API_URL`).

## Modes

### Free mode
A chat interface backed by the agent's ReAct loop. The agent can use MCP tools, reason step-by-step, and stream its thinking in real time. Steps appear in the **Agent Steps** panel on the right.

### Pipeline mode
A form-based interface for blockchain transaction analysis. Enter a Chain ID and one or more transaction hashes — the backend runs a multi-pass analysis pipeline for each hash and streams progress live.

Switching between modes preserves both the chat history and the pipeline form state (neither is unmounted).

## Configuration

Copy `.env` and adjust as needed (all variables are optional):

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Backend base URL |
| `VITE_DEFAULT_MODEL` | `openai/gpt-4o-mini` | Default LLM model |
| `VITE_DEFAULT_MODE` | `free` | Initial mode: `free` or `pipeline` |
| `VITE_DEFAULT_TEMPERATURE` | `0.7` | Sampling temperature |
| `VITE_DEFAULT_MAX_TOKENS` | `1024` | Max tokens per response |
| `VITE_DEFAULT_SYSTEM_PROMPT` | — | Default system prompt |

Settings are persisted in `localStorage` between sessions.

## Project structure

```
src/
├── api/
│   └── client.ts          # All backend communication (SSE streaming, mode sync)
├── hooks/
│   ├── useChat.ts          # Free mode: streaming ReAct steps, message history
│   ├── usePipeline.ts      # Pipeline mode: structured tx analysis, step tracking
│   └── useAgentActivity.ts # Derives display-friendly state from raw AgentActivity
├── components/
│   ├── PipelineScreen.tsx  # Chain ID + tx hash form, progress, result
│   ├── AgentStepsPanel.tsx # Live step feed (shared between both modes)
│   ├── ChatMessage.tsx     # Rendered markdown message bubble
│   ├── ChatInput.tsx       # Message input with stop button
│   ├── SettingsPanel.tsx   # Collapsible settings (mode toggle, model, prompt, …)
│   └── McpPanel.tsx        # MCP server list with enable/disable
├── types/
│   └── index.ts            # Shared TypeScript types
└── App.tsx                 # Layout, mode switching, state wiring
```

## Scripts

```bash
npm run dev       # Start dev server with HMR
npm run build     # Type-check + production build → dist/
npm run preview   # Serve production build locally
npm run lint      # ESLint
```

## Stack

- **React 19** + **TypeScript**
- **Vite** — build tool
- **lucide-react** — icons
- **react-markdown** + **remark-gfm** — markdown rendering in chat messages
