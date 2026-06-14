import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMResponse, ToolDefinition, ContentBlock } from './types.js';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(params: {
    system: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    model?: string;
  }): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: params.model ?? 'claude-sonnet-4-20250514',
      max_tokens: params.maxTokens ?? 2048,
      system: params.system,
      messages: params.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map(b => this.toAnthropicBlock(b)),
      })),
      ...(params.tools?.length ? {
        tools: params.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
      } : {}),
    });

    return {
      content: response.content.map(b => this.fromAnthropicBlock(b)),
      stopReason: response.stop_reason ?? 'end_turn',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private toAnthropicBlock(block: ContentBlock): Anthropic.ContentBlockParam {
    switch (block.type) {
      case 'text': return { type: 'text', text: block.text };
      case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'tool_result': return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content };
    }
  }

  private fromAnthropicBlock(block: Anthropic.ContentBlock): ContentBlock {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> };
    return { type: 'text', text: '' };
  }
}
