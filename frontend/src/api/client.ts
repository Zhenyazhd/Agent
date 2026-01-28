import type { ChatRequest, ChatResponse, StreamChunk, AgentRunResponse, Tool } from '../types';

const DEFAULT_API_URL = 'http://localhost:3000';

export async function sendMessage(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL
): Promise<ChatResponse> {
  const response = await fetch(`${apiUrl}/v1/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP error: ${response.status}`);
  }

  return response.json();
}

export async function* sendMessageStream(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const chunk: StreamChunk = JSON.parse(data);
          yield chunk;
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }
}

/// Agent run - executes with tools
export async function runAgent(
  request: ChatRequest,
  apiUrl: string = DEFAULT_API_URL
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
