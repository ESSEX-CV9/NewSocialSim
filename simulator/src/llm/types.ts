export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  chat(params: {
    system: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    model?: string;
  }): Promise<LLMResponse>;
}

export interface LLMConfig {
  provider: 'claude' | 'deepseek' | 'gemini';
  apiKey: string;
  highModel: string;
  lowModel: string;
  baseUrl: string | undefined;
  proxy: string | undefined;
}
