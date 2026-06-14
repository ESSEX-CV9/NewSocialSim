import { GoogleGenAI, type Content, type FunctionDeclaration, type Part, type Tool, Type } from '@google/genai';
import type { LLMProvider, LLMMessage, LLMResponse, ToolDefinition, ContentBlock } from './types.js';

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async chat(params: {
    system: string;
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    model?: string;
  }): Promise<LLMResponse> {
    const contents: Content[] = params.messages.map(m => this.toGeminiContent(m));

    const config: Record<string, unknown> = {
      systemInstruction: params.system,
      maxOutputTokens: params.maxTokens ?? 2048,
    };
    if (params.tools?.length) {
      config.tools = [{ functionDeclarations: params.tools.map(t => this.toFunctionDecl(t)) }];
    }

    const response = await this.client.models.generateContent({
      model: params.model ?? 'gemini-2.5-flash',
      contents,
      config,
    });

    const content: ContentBlock[] = [];
    const parts = response.candidates?.[0]?.content?.parts ?? [];

    for (const part of parts) {
      if (part.text) {
        content.push({ type: 'text', text: part.text });
      }
      if (part.functionCall) {
        content.push({
          type: 'tool_use',
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          name: part.functionCall.name!,
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    const hasToolCalls = content.some(b => b.type === 'tool_use');

    return {
      content,
      stopReason: hasToolCalls ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  private toGeminiContent(msg: LLMMessage): Content {
    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      return { role, parts: [{ text: msg.content }] };
    }

    const parts: Part[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'tool_use') {
        parts.push({ functionCall: { name: block.name, args: block.input } });
      } else if (block.type === 'tool_result') {
        parts.push({ functionResponse: { name: 'tool', response: { result: block.content } } });
      }
    }
    return { role, parts };
  }

  private toFunctionDecl(tool: ToolDefinition): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: this.convertSchema(tool.input_schema),
    };
  }

  private convertSchema(schema: Record<string, unknown>): any {
    const result: any = {};
    if (schema.type === 'object') {
      result.type = Type.OBJECT;
      if (schema.properties) {
        result.properties = {};
        for (const [key, val] of Object.entries(schema.properties as Record<string, any>)) {
          result.properties[key] = this.convertSchemaValue(val);
        }
      }
      if (schema.required) result.required = schema.required;
    }
    return result;
  }

  private convertSchemaValue(val: any): any {
    const typeMap: Record<string, any> = { string: Type.STRING, number: Type.NUMBER, boolean: Type.BOOLEAN, integer: Type.INTEGER };
    return { type: typeMap[val.type] ?? Type.STRING, description: val.description };
  }
}
