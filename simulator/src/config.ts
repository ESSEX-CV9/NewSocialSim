import { readFileSync, existsSync } from 'fs';
import type { SimulatorConfig } from './ecs/types.js';

const DEFAULT_ADMIN_TOKEN = 'dev-admin-key';

/** 启动配置只读基础设施字段；worldId/账号/内容池一律随活动世界加载，不在此处。
 *  允许的来源：可选 config 文件、环境变量、内置默认。 */
export function loadConfig(configPath?: string): SimulatorConfig {
  const base: SimulatorConfig = {
    apiBaseUrl: process.env.SOCIALSIM_API_URL ?? 'http://127.0.0.1:3000',
    adminToken: process.env.SOCIALSIM_ADMIN_KEY ?? DEFAULT_ADMIN_TOKEN,
    tickIntervalMs: 10_000,
  };

  if (configPath && existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw) as Partial<SimulatorConfig>;
    return {
      apiBaseUrl: parsed.apiBaseUrl ?? base.apiBaseUrl,
      adminToken: parsed.adminToken ?? base.adminToken,
      tickIntervalMs: parsed.tickIntervalMs ?? base.tickIntervalMs,
    };
  }

  return base;
}
