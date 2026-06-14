import OpenAI from 'openai';
import type { LLMProvider, LLMMessage, LLMResponse, ToolDefinition, ContentBlock } from './types.js';

export class DeepSeekProvider implements LLMProvider {
  private client: OpenAI;

  constructor(apiKey: string, baseURL = 'https://api.deepseek.com') {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async chat(params: {
    system: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    model?: string;
  }): Promise<LLMResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.system },
      ...params.messages.map(m => this.toOpenAIMessage(m)),
    ];

    const response = await this.client.chat.completions.create({
      model: params.model ?? 'deepseek-chat',
      max_tokens: params.maxTokens ?? 2048,
      messages,
      ...(params.tools?.length ? {
        tools: params.tools.map(t => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
      } : {}),
    });

    const choice = response.choices[0]!;
    const content: ContentBlock[] = [];

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if ('function' in tc) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
      }
    }

    return {
      content,
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  private toOpenAIMessage(msg: LLMMessage): OpenAI.ChatCompletionMessageParam {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    if (msg.role === 'assistant') {
      const textParts = msg.content.filter(b => b.type === 'text');
      const toolCalls = msg.content.filter(b => b.type === 'tool_use');
      return {
        role: 'assistant',
        content: textParts.map(b => (b as { text: string }).text).join('\n') || null,
        ...(toolCalls.length ? {
          tool_calls: toolCalls.map(b => {
            const tc = b as { id: string; name: string; input: Record<string, unknown> };
            return { id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.input) } };
          }),
        } : {}),
      };
    }

    const toolResults = msg.content.filter(b => b.type === 'tool_result');
    if (toolResults.length > 0) {
      const tr = toolResults[0] as { tool_use_id: string; content: string };
      return { role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content };
    }

    return { role: 'user', content: msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n') };
  }
}
