import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { LLMConfig } from './types.js';

const DEFAULT_CONFIG_PATH = resolve('data', 'llm-config.json');

interface ProviderEntry {
  id: string;
  name: string;
  source: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

interface ConfigFile {
  providers: ProviderEntry[];
  highModel: string;
  lowModel: string;
}

export function loadLLMConfig(configPath?: string): LLMConfig | null {
  const file = configPath ?? DEFAULT_CONFIG_PATH;
  if (!existsSync(file)) return null;

  const raw = readFileSync(file, 'utf-8').replace(/^﻿/, '');
  const config = JSON.parse(raw) as ConfigFile;
  if (!config.providers?.length) return null;

  const highRef = config.highModel;
  if (!highRef || !highRef.includes('|')) return null;

  const [providerId, modelId] = highRef.split('|', 2);
  const provider = config.providers.find(p => p.id === providerId);
  if (!provider?.apiKey) return null;

  const sourceToProvider: Record<string, LLMConfig['provider']> = {
    anthropic: 'claude', google: 'gemini', openai: 'deepseek', deepseek: 'deepseek',
  };

  let lowModelId = modelId!;
  if (config.lowModel?.includes('|')) {
    lowModelId = config.lowModel.split('|', 2)[1]!;
  }

  return {
    provider: sourceToProvider[provider.source] ?? 'claude',
    apiKey: provider.apiKey,
    highModel: modelId!,
    lowModel: lowModelId,
    baseUrl: provider.baseUrl || undefined,
    proxy: undefined,
  };
}
