import type { LLMProvider, LLMMessage, ContentBlock, ToolDefinition } from './types.js';
import type { ToolExecutor, ToolContext } from './tools.js';
import { logger } from '../logger.js';

export interface AgentTask {
  systemPrompt: string;
  userMessage: string;
  toolContext: ToolContext;
  model?: string;
  maxSteps?: number;
  maxTokens?: number;
}

export interface AgentLogEntry {
  step: number;
  role: 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  timestamp: number;
  tokens?: { input: number; output: number };
}

export interface AgentResult {
  finalText: string;
  log: AgentLogEntry[];
  totalTokens: { input: number; output: number };
  steps: number;
}

const DEFAULT_MAX_STEPS = 15;

export class AgentRuntime {
  constructor(
    private provider: LLMProvider,
    private tools: ToolExecutor,
  ) {}

  async run(task: AgentTask): Promise<AgentResult> {
    const maxSteps = task.maxSteps ?? DEFAULT_MAX_STEPS;
    const log: AgentLogEntry[] = [];
    const totalTokens = { input: 0, output: 0 };
    const messages: LLMMessage[] = [{ role: 'user', content: task.userMessage }];

    logger.info(`[Agent] Starting task: "${task.userMessage.slice(0, 80)}..."`);

    for (let step = 1; step <= maxSteps; step++) {
      const chatParams: Parameters<LLMProvider['chat']>[0] = {
        system: task.systemPrompt,
        messages,
        tools: this.tools.definitions,
      };
      if (task.model) chatParams.model = task.model;
      if (task.maxTokens) chatParams.maxTokens = task.maxTokens;
      const response = await this.provider.chat(chatParams);

      totalTokens.input += response.usage.inputTokens;
      totalTokens.output += response.usage.outputTokens;

      const textBlocks = response.content.filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text');
      const toolCalls = response.content.filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use');

      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => b.text).join('\n');
        log.push({
          step, role: 'assistant', content: text,
          timestamp: Date.now(),
          tokens: { input: response.usage.inputTokens, output: response.usage.outputTokens },
        });
        logger.info(`[Agent] Step ${step} text: "${text.slice(0, 100)}..."`);
      }

      if (toolCalls.length === 0 || response.stopReason === 'end_turn') {
        const finalText = textBlocks.map(b => b.text).join('\n');
        logger.info(`[Agent] Completed in ${step} steps (${totalTokens.input}+${totalTokens.output} tokens)`);
        return { finalText, log, totalTokens, steps: step };
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: ContentBlock[] = [];
      for (const call of toolCalls) {
        logger.info(`[Agent] Step ${step} tool: ${call.name}(${JSON.stringify(call.input).slice(0, 100)})`);
        const result = await this.tools.execute(call.name, call.input, task.toolContext);
        log.push({
          step, role: 'tool', content: result,
          toolName: call.name, toolInput: call.input,
          timestamp: Date.now(),
        });
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: result });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    logger.warn(`[Agent] Reached max steps (${maxSteps})`);
    const finalText = log.filter(e => e.role === 'assistant').map(e => e.content).pop() ?? '';
    return { finalText, log, totalTokens, steps: maxSteps };
  }
}
