import fs from 'node:fs';
import path from 'node:path';
import { config as appConfig } from '../../config.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, Type } from '@google/genai';
import type { WorldManager } from '../../core/world/world-manager.js';
import { ValidationError } from '../../core/errors/app-error.js';

interface ProviderEntry {
  id: string;
  name: string;
  source: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

interface LLMConfigFile {
  providers: ProviderEntry[];
  highModel: string;
  lowModel: string;
}

interface ResolvedModel {
  source: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
}

interface ToolCall { id: string; name: string; input: Record<string, unknown> }
interface StepLog { step: number; role: 'assistant' | 'tool'; content: string; toolName?: string; toolInput?: Record<string, unknown>; model?: string; timestamp: number }

export interface AgentRunResult {
  taskLabel: string;
  steps: number;
  tokens: { input: number; output: number };
  log: StepLog[];
  finalText: string;
}

const TOOLS = [
  { name: 'browse_timeline', description: 'Browse the global timeline to see recent posts.', input_schema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'get_trending_topics', description: 'Get currently active topics.', input_schema: { type: 'object', properties: {} } },
  { name: 'list_lore', description: 'List all lore documents with summaries.', input_schema: { type: 'object', properties: {} } },
  { name: 'read_lore', description: 'Read a lore document.', input_schema: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] } },
  { name: 'search_posts', description: 'Search posts by keyword.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'create_post', description: 'Create a post as a specified user.', input_schema: { type: 'object', properties: { authorId: { type: 'number' }, content: { type: 'string' } }, required: ['authorId', 'content'] } },
] as const;

export class AgentRunner {
  constructor(private worldManager: WorldManager) {}

  private resolveModel(): ResolvedModel {
    const file = path.join(appConfig.dataDir, 'llm-config.json');
    if (!fs.existsSync(file)) throw new ValidationError('No LLM config. Please set up in the LLM Config panel first.');
    const raw = fs.readFileSync(file, 'utf-8').replace(/^﻿/, '');
    const config = JSON.parse(raw) as LLMConfigFile;
    if (!config.providers?.length) throw new ValidationError('No LLM providers configured.');

    const modelRef = config.highModel;
    if (!modelRef) throw new ValidationError('No high-tier model selected.');
    const sepIdx = modelRef.indexOf('|');
    if (sepIdx < 0) throw new ValidationError(`Invalid model reference: ${modelRef}`);
    const providerId = modelRef.slice(0, sepIdx);
    const modelId = modelRef.slice(sepIdx + 1);
    const provider = config.providers.find(p => p.id === providerId);
    if (!provider) throw new ValidationError(`Provider "${providerId}" not found.`);
    if (!provider.apiKey) throw new ValidationError(`Provider "${provider.name}" has no API key.`);

    return { source: provider.source, apiKey: provider.apiKey, baseUrl: provider.baseUrl, modelId };
  }

  async run(prompt: string): Promise<AgentRunResult> {
    const model = this.resolveModel();
    const system = 'You are an AI assistant managing a social media simulation. Use the provided tools to interact with the world. Complete the user\'s request, then summarize what you did.';
    const log: StepLog[] = [];
    const tokens = { input: 0, output: 0 };

    try {
      switch (model.source) {
        case 'anthropic': return await this.runClaude(model, system, prompt, log, tokens);
        case 'google': return await this.runGemini(model, system, prompt, log, tokens);
        default: return await this.runOpenAICompat(model, system, prompt, log, tokens);
      }
    } catch (err: any) {
      const message = err.message ?? String(err);
      if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid') || message.includes('API key')) {
        throw new ValidationError(`LLM API authentication failed. Check your API key. (${message.slice(0, 200)})`);
      }
      throw new ValidationError(`LLM API error (${model.source}): ${message.slice(0, 300)}`);
    }
  }

  private async runClaude(model: ResolvedModel, system: string, prompt: string, log: StepLog[], tokens: { input: number; output: number }): Promise<AgentRunResult> {
    const client = new Anthropic({ apiKey: model.apiKey, ...(model.baseUrl ? { baseURL: model.baseUrl } : {}) });
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
    const tools = TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema }));

    for (let step = 1; step <= 15; step++) {
      const res = await client.messages.create({ model: model.modelId, max_tokens: 2048, system, messages, tools });
      tokens.input += res.usage.input_tokens;
      tokens.output += res.usage.output_tokens;

      const textParts = res.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text);
      const toolCalls = res.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];

      if (textParts.length) log.push({ step, role: 'assistant', content: textParts.join('\n'), model: model.modelId, timestamp: Date.now() });

      if (!toolCalls.length || res.stop_reason === 'end_turn') {
        return { taskLabel: prompt.slice(0, 80), steps: step, tokens, log, finalText: textParts.join('\n') };
      }

      messages.push({ role: 'assistant', content: res.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tc of toolCalls) {
        const result = await this.executeTool(tc.name, tc.input as Record<string, unknown>);
        log.push({ step, role: 'tool', content: result, toolName: tc.name, toolInput: tc.input as Record<string, unknown>, timestamp: Date.now() });
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    return { taskLabel: prompt.slice(0, 80), steps: 15, tokens, log, finalText: '' };
  }

  private async runOpenAICompat(model: ResolvedModel, system: string, prompt: string, log: StepLog[], tokens: { input: number; output: number }): Promise<AgentRunResult> {
    const defaultBaseUrl = model.source === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1';
    const client = new OpenAI({ apiKey: model.apiKey, baseURL: model.baseUrl || defaultBaseUrl });
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];
    const tools: OpenAI.ChatCompletionTool[] = TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

    for (let step = 1; step <= 15; step++) {
      const res = await client.chat.completions.create({ model: model.modelId, max_tokens: 2048, messages, tools });
      tokens.input += res.usage?.prompt_tokens ?? 0;
      tokens.output += res.usage?.completion_tokens ?? 0;
      const choice = res.choices[0]!;

      if (choice.message.content) log.push({ step, role: 'assistant', content: choice.message.content, model: model.modelId, timestamp: Date.now() });

      if (!choice.message.tool_calls?.length || choice.finish_reason !== 'tool_calls') {
        return { taskLabel: prompt.slice(0, 80), steps: step, tokens, log, finalText: choice.message.content ?? '' };
      }

      messages.push(choice.message);
      for (const tc of choice.message.tool_calls) {
        if (!('function' in tc)) continue;
        const input = JSON.parse(tc.function.arguments || '{}');
        const result = await this.executeTool(tc.function.name, input);
        log.push({ step, role: 'tool', content: result, toolName: tc.function.name, toolInput: input, timestamp: Date.now() });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }
    return { taskLabel: prompt.slice(0, 80), steps: 15, tokens, log, finalText: '' };
  }

  private async runGemini(model: ResolvedModel, system: string, prompt: string, log: StepLog[], tokens: { input: number; output: number }): Promise<AgentRunResult> {
    const client = new GoogleGenAI({ apiKey: model.apiKey });
    const typeMap: Record<string, any> = { string: Type.STRING, number: Type.NUMBER, boolean: Type.BOOLEAN };
    const geminiTools = [{
      functionDeclarations: TOOLS.map(t => ({
        name: t.name, description: t.description,
        parameters: {
          type: Type.OBJECT,
          properties: Object.fromEntries(Object.entries((t.input_schema as any).properties ?? {}).map(([k, v]: any) => [k, { type: typeMap[v.type] ?? Type.STRING, description: v.description }])),
          ...(((t.input_schema as any).required) ? { required: (t.input_schema as any).required } : {}),
        },
      })),
    }];

    const contents: any[] = [{ role: 'user', parts: [{ text: prompt }] }];

    for (let step = 1; step <= 15; step++) {
      const res = await client.models.generateContent({ model: model.modelId, contents, config: { systemInstruction: system, maxOutputTokens: 2048, tools: geminiTools } });
      tokens.input += res.usageMetadata?.promptTokenCount ?? 0;
      tokens.output += res.usageMetadata?.candidatesTokenCount ?? 0;

      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
      const fnCalls = parts.filter((p: any) => p.functionCall);

      if (textParts.length) log.push({ step, role: 'assistant', content: textParts.join('\n'), model: model.modelId, timestamp: Date.now() });

      if (!fnCalls.length) {
        return { taskLabel: prompt.slice(0, 80), steps: step, tokens, log, finalText: textParts.join('\n') };
      }

      contents.push({ role: 'model', parts });
      const responseParts: any[] = [];
      for (const fc of fnCalls) {
        const fnCall = fc.functionCall!;
        const input = (fnCall.args ?? {}) as Record<string, unknown>;
        const result = await this.executeTool(fnCall.name!, input);
        log.push({ step, role: 'tool', content: result, toolName: fnCall.name!, toolInput: input, timestamp: Date.now() });
        responseParts.push({ functionResponse: { name: fnCall.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responseParts });
    }
    return { taskLabel: prompt.slice(0, 80), steps: 15, tokens, log, finalText: '' };
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    try {
      const { db, clock } = this.worldManager.current();
      switch (name) {
        case 'browse_timeline': {
          const limit = (input.limit as number) ?? 10;
          const rows = db.prepare('SELECT p.id, u.handle, p.content, p.like_count, p.repost_count FROM posts p JOIN users u ON u.id = p.author_id WHERE p.deleted = 0 ORDER BY p.created_at DESC LIMIT ?').all(limit);
          return JSON.stringify(rows);
        }
        case 'get_trending_topics': {
          const rows = db.prepare("SELECT id, title, heat, stage, tags FROM topics WHERE stage != 'retired' ORDER BY heat DESC").all();
          return JSON.stringify(rows);
        }
        case 'list_lore': {
          const loreDir = path.join(this.worldManager.getWorldDir(this.worldManager.current().worldId), 'lore');
          if (!fs.existsSync(loreDir)) return '[]';
          const files = fs.readdirSync(loreDir).filter(f => f.endsWith('.md'));
          return JSON.stringify(files.map(f => ({ filename: f })));
        }
        case 'read_lore': {
          const loreDir = path.join(this.worldManager.getWorldDir(this.worldManager.current().worldId), 'lore');
          const filePath = path.join(loreDir, input.filename as string);
          if (!fs.existsSync(filePath)) return JSON.stringify({ error: 'File not found' });
          return fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
        }
        case 'search_posts': {
          const q = `%${input.query as string}%`;
          const rows = db.prepare('SELECT p.id, u.handle, p.content FROM posts p JOIN users u ON u.id = p.author_id WHERE p.deleted = 0 AND p.content LIKE ? LIMIT 10').all(q);
          return JSON.stringify(rows);
        }
        case 'create_post': {
          const authorId = input.authorId as number;
          const content = (input.content as string).trim();
          const id = Number(db.prepare('INSERT INTO posts (author_id, content, created_at) VALUES (?, ?, ?)').run(authorId, content, clock.now()).lastInsertRowid);
          return JSON.stringify({ success: true, postId: id });
        }
        default:
          return JSON.stringify({ error: `Unknown tool: ${name}` });
      }
    } catch (err: any) {
      return JSON.stringify({ error: err.message });
    }
  }
}
