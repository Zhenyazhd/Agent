import type { ChatRequest, ChatResponse, StreamChunk, AgentRunResponse, AgentStreamChunk, Tool, Model } from '../types';
import { extractModels } from '../types';
import { env } from '../env.ts';

const DEFAULT_API_URL = env.VITE_API_URL ?? 'http://localhost:3000';

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 30_000, signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const signal = callerSignal
    ? AbortSignal.any([controller.signal, callerSignal])
    : controller.signal;
  try {
    return await fetch(input, { ...rest, signal });
  } finally {
    clearTimeout(id);
  }
}

async function parseHttpError(response: Response): Promise<Error> {
  let message = `HTTP error: ${response.status}`;
  try {
    const data = await response.json();
    if (typeof data?.error === 'string') {
      message = data.error;
    }
  } catch {
  }
  return new Error(message);
}

type SSEParseOptions<T> = {
  stopToken?: string;
  flushOnDone?: boolean;
  onChunk?: (chunk: T) => boolean | void;
};

async function* parseSSEStream<T>(
  response: Response,
  signal: AbortSignal | undefined,
  options: SSEParseOptions<T> = {}
): AsyncGenerator<T> {
  const { stopToken = '[DONE]', flushOnDone = false, onChunk } = options;

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const abortHandler = () => reader.cancel();
  signal?.addEventListener('abort', abortHandler);

  const stopRef = { seen: false };

  const processBuffer = function* (buf: string): Generator<T> {
    const events = buf.split(/\n\n/);
    for (const event of events) {
      if (!event.trim()) continue;
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === stopToken) {
          stopRef.seen = true;
          return;
        }
        try {
          const chunk = JSON.parse(data) as T;
          yield chunk;
          if (onChunk?.(chunk) === true) {
            stopRef.seen = true;
            return;
          }
        } catch (err) {
          if (env.DEV) {
            console.warn('[SSE] Failed to parse chunk as JSON:', data, err);
          }
        }
      }
    }
  };

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const { done, value } = await reader.read();

      if (done) {
        if (flushOnDone && buffer.trim()) {
          buffer = buffer.replace(/\r\n/g, '\n');
          for (const chunk of processBuffer(buffer)) {
            yield chunk;
            if (onChunk?.(chunk) === true) return;
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      const events = buffer.split(/\n\n/);
      buffer = events.pop() || '';

      for (const chunk of processBuffer(events.join('\n\n'))) {
        yield chunk;
        if (onChunk?.(chunk) === true) {
          reader.cancel();
          return;
        }
      }
      if (stopRef.seen) return;
    }
  } catch (err) {
    if (signal?.aborted || err instanceof DOMException) {
      reader.cancel();
      throw err;
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', abortHandler);
  }
}

export async function sendMessage(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL,
  signal?: AbortSignal
): Promise<ChatResponse> {
  const response = await fetchWithTimeout(`${apiUrl}/v1/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw await parseHttpError(response);
  }

  return response.json();
}

export async function* sendMessageStream(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const systemMessage = request.system_prompt
  ? [{ role: 'system' as const, content: request.system_prompt }]
  : [];

  const messages = [
    ...systemMessage,
    ...request.conversation,
    { role: 'user' as const, content: request.message },
  ];
  
  const response = await fetchWithTimeout(`${apiUrl}/v1/agent/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: messages,
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    throw await parseHttpError(response);
  }

  yield* parseSSEStream<StreamChunk>(response, signal, { stopToken: '[DONE]' });
}

export async function runAgent(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL,
  signal?: AbortSignal
): Promise<AgentRunResponse> {
  const response = await fetchWithTimeout(`${apiUrl}/v1/agent/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: request.message,
      conversation: request.conversation,
      system_prompt: request.system_prompt,
      model: request.model,
    }),
    signal,
  });

  if (!response.ok) {
    throw await parseHttpError(response);
  }

  return response.json();
}

export async function* runAgentStream(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL,
  signal?: AbortSignal
): AsyncGenerator<AgentStreamChunk> {
  const response = await fetchWithTimeout(`${apiUrl}/v1/agent/run/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: request.message,
      conversation: request.conversation,
      system_prompt: request.system_prompt,
      model: request.model,
      mode: request.mode,
    }),
    signal,
  });

  if (!response.ok) {
    throw await parseHttpError(response);
  }

  yield* parseSSEStream<AgentStreamChunk>(response, signal, {
    stopToken: '[DONE]',
    flushOnDone: true,
    onChunk(chunk) {
      if (chunk.done) return true;
    },
  });
}

export async function fetchTools(apiUrl: string = DEFAULT_API_URL): Promise<Tool[]> {
  const response = await fetchWithTimeout(`${apiUrl}/v1/agent/tools`);
  if (!response.ok) {
    throw await parseHttpError(response);
  }
  const data = await response.json();
  return data.tools || [];
}

export async function fetchModels(apiUrl: string = DEFAULT_API_URL): Promise<Model[]> {
  const response = await fetchWithTimeout(`${apiUrl}/v1/models`);
  if (!response.ok) {
    throw await parseHttpError(response);
  }
  const data: unknown = await response.json();
  return extractModels(data);
}

export interface McpServer {
  name: string;
  enabled: boolean;
  connected: boolean;
  transport_type: string;
  tools_count: number;
  tools: string[];
}

export async function fetchMcpServers(
  apiUrl: string = DEFAULT_API_URL,
  signal?: AbortSignal
): Promise<McpServer[]> {
  const response = await fetchWithTimeout(`${apiUrl}/v1/mcp/servers`, { signal });
  if (!response.ok) throw await parseHttpError(response);
  const data = await response.json();
  return data.mcp_enabled ? (data.servers ?? []) : [];
}

export async function toggleMcpServer(
  serverName: string,
  enable: boolean,
  apiUrl: string = DEFAULT_API_URL,
  signal?: AbortSignal
): Promise<McpServer[]> {
  const endpoint = enable ? 'enable' : 'disable';
  const response = await fetchWithTimeout(`${apiUrl}/v1/mcp/servers/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server_name: serverName }),
    signal,
  });
  if (!response.ok) throw await parseHttpError(response);
  const data = await response.json();
  return data.servers ?? [];
}

export async function setAgentMode(
  mode: 'free' | 'pipeline',
  apiUrl: string = DEFAULT_API_URL,
): Promise<void> {
  await fetchWithTimeout(`${apiUrl}/v1/agent/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
    timeoutMs: 5_000,
  });
}

export async function healthCheck(apiUrl: string = DEFAULT_API_URL): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${apiUrl}/health`, { timeoutMs: 5_000 });
    return response.ok;
  } catch {
    return false;
  }
}
