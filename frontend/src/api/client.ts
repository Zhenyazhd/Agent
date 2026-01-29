import type { ChatRequest, ChatResponse, StreamChunk, AgentRunResponse, Tool } from '../types';

const DEFAULT_API_URL =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export async function sendMessage(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL,
  signal?: AbortSignal
): Promise<ChatResponse> {
  const response = await fetch(`${apiUrl}/v1/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP error: ${response.status}`);
  }

  return response.json();
}

export async function* sendMessageStream(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const response = await fetch(`${apiUrl}/v1/chat/completions/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        ...(request.system_prompt
          ? [{ role: 'system', content: request.system_prompt }]
          : []),
        ...request.conversation,
        { role: 'user', content: request.message },
      ],
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const abortHandler = () => {
    reader.cancel();
  };
  signal?.addEventListener('abort', abortHandler);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      const events = buffer.split(/\n\n/);
      buffer = events.pop() || '';

      for (const event of events) {
        if (!event.trim()) continue;

        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;

          const data = line.slice(5).trim();
          if (data === '[DONE]') return;

          try {
            const chunk: StreamChunk = JSON.parse(data);
            yield chunk;
          } catch {
          }
        }
      }
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

/// Agent run - executes with tools
export async function runAgent(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL,
  signal?: AbortSignal
): Promise<AgentRunResponse> {
  const response = await fetch(`${apiUrl}/v1/agent/run`, {
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
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP error: ${response.status}`);
  }

  return response.json();
}

export async function fetchTools(apiUrl: string = DEFAULT_API_URL): Promise<Tool[]> {
  const response = await fetch(`${apiUrl}/v1/agent/tools`);
  if (!response.ok) {
    throw new Error(`Failed to fetch tools: ${response.status}`);
  }
  const data = await response.json();
  return data.tools || [];
}

export async function fetchModels(apiUrl: string = DEFAULT_API_URL): Promise<any> {
  const response = await fetch(`${apiUrl}/v1/models`);
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }
  return response.json();
}

export async function healthCheck(apiUrl: string = DEFAULT_API_URL): Promise<boolean> {
  try {
    const response = await fetch(`${apiUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
