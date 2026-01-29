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

export interface Settings {
  apiUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  agentMode: boolean;
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

export type StepType = 'thinking' | 'tool_call' | 'tool_result' | 'final_answer' | 'error';

export interface AgentStep {
  step_id?: string; 
  step_type: StepType;
  content: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
}

export interface AgentRunResponse {
  id: string;
  final_answer: string;
  steps: AgentStep[];
  iterations: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
