export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
  steps?: AgentStep[];
}

export interface ChatRequest {
  message: string;
  conversation: Array<{ role: Role; content: string }>;
  system_prompt?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  mode?: AppMode;
}

export interface ChatResponse {
  id: string;
  message: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  content: string;
  finish_reason?: string;
}

export type AppMode = 'free' | 'pipeline';

export interface Settings {
  apiUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  mode: AppMode;
}

export interface Model {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt: string;
    completion: string;
  };
}

export type ModelsResponse =
  | { data: Model[] }
  | { models: Model[] }
  | Model[];

export function extractModels(data: unknown): Model[] {
  if (Array.isArray(data)) {
    return data.map(normalizeModelItem).filter(Boolean) as Model[];
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const arr = (obj.data ?? obj.models) as unknown;
    if (Array.isArray(arr)) {
      return arr.map(normalizeModelItem).filter(Boolean) as Model[];
    }
  }
  return [];
}

function normalizeModelItem(item: unknown): Model | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : typeof o.name === 'string' ? o.name : null;
  if (!id) return null;
  const name = typeof o.name === 'string' ? o.name : id;
  const model: Model = { id, name };
  if (typeof o.context_length === 'number') model.context_length = o.context_length;
  if (o.pricing && typeof o.pricing === 'object') {
    const p = o.pricing as Record<string, unknown>;
    if (typeof p.prompt === 'string' && typeof p.completion === 'string') {
      model.pricing = { prompt: p.prompt, completion: p.completion };
    }
  }
  return model;
}

export type StepType = 'thinking' | 'tool_call' | 'tool_result' | 'final_answer' | 'error';

export interface AgentStep {
  step_id?: string;
  step_type: StepType;
  content: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  timestamp?: string;
}

export interface NormalizedStep {
  type: AgentStep['step_type'];
  label: string;
  iconType: AgentStep['step_type'];
  isMeta: boolean;
  preview?: string;
  details?: string;
  raw: AgentStep;
}

function formatToolNameForStep(name?: string): string {
  if (!name) return '';
  return name.replace(/^mcp_/, '').replace(/_/g, ' / ');
}

export function normalizeStep(step: AgentStep): NormalizedStep {
  const type = step.step_type;
  const isMeta =
    type === 'thinking' &&
    (step.content.startsWith('Starting') || step.content.startsWith('Iteration'));

  let label: string;
  let preview: string | undefined;
  let details: string | undefined;

  switch (type) {
    case 'tool_call':
      label = step.tool_name ? formatToolNameForStep(step.tool_name) : 'tool call';
      preview = step.tool_name ? `Calling ${formatToolNameForStep(step.tool_name)}` : undefined;
      details = step.tool_input;
      break;
    case 'tool_result':
      label = step.tool_name ? `Result: ${formatToolNameForStep(step.tool_name)}` : 'Got result';
      preview = step.tool_name ? `Got result from ${formatToolNameForStep(step.tool_name).split(' / ')[0] || 'tool'}` : 'Got result';
      details = step.content;
      break;
    case 'thinking':
      label = isMeta ? step.content : (step.content || 'Thinking');
      preview = isMeta ? step.content : (step.content ? step.content.slice(0, 60) + (step.content.length > 60 ? '...' : '') : undefined);
      details = step.content || undefined;
      break;
    case 'error':
      label = 'Error';
      preview = step.content.slice(0, 60);
      details = step.content;
      break;
    case 'final_answer':
      label = 'Final answer';
      preview = step.content.slice(0, 80) + (step.content.length > 80 ? '...' : '');
      details = step.content;
      break;
    default: {
      const fallback = type as string;
      label = fallback.replace('_', ' ');
      preview = step.content.slice(0, 40);
      details = step.content || undefined;
      break;
    }
  }

  return {
    type,
    label,
    iconType: type,
    isMeta,
    preview,
    details,
    raw: step,
  };
}

export interface AgentRunResponse {
  id: string;
  final_answer: string;
  steps: AgentStep[];
  iterations: number;
}

export interface AgentStreamChunk {
  id: string;
  step: AgentStep;
  done?: boolean;
}

export interface AgentActivity {
  isActive: boolean;
  currentStep: AgentStep | null;
  iteration: number;
  steps: AgentStep[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
