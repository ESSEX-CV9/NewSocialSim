import { readFileSync, existsSync } from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SimulatorConfig } from './ecs/types.js';

const DEFAULT_ADMIN_TOKEN = 'dev-admin-key';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const DEFAULT_DATA_DIR = process.env.SOCIALSIM_DATA_DIR ?? path.join(repoRoot, 'data');

/** 启动配置只读基础设施字段；worldId/账号/内容池一律随活动世界加载，不在此处。
 *  允许的来源：可选 config 文件、环境变量、内置默认。 */
export function loadConfig(configPath?: string): SimulatorConfig {
  const base: SimulatorConfig = {
    apiBaseUrl: process.env.SOCIALSIM_API_URL ?? 'http://127.0.0.1:3000',
    adminToken: process.env.SOCIALSIM_ADMIN_KEY ?? DEFAULT_ADMIN_TOKEN,
    tickIntervalMs: 10_000,
    dataDir: DEFAULT_DATA_DIR,
    // 默认指向本机编辑器后端；编辑器未起时 POST 失败被吞，不影响写世界。空串=关闭推流。
    traceSinkUrl: process.env.SOCIALSIM_TRACE_SINK_URL ?? 'http://127.0.0.1:5176',
    controlPort: Number(process.env.SOCIALSIM_CONTROL_PORT ?? 5177),
  };

  if (configPath && existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw) as Partial<SimulatorConfig>;
    return {
      apiBaseUrl: parsed.apiBaseUrl ?? base.apiBaseUrl,
      adminToken: parsed.adminToken ?? base.adminToken,
      tickIntervalMs: parsed.tickIntervalMs ?? base.tickIntervalMs,
      dataDir: parsed.dataDir ?? base.dataDir,
      traceSinkUrl: parsed.traceSinkUrl ?? base.traceSinkUrl,
      controlPort: parsed.controlPort ?? base.controlPort,
    };
  }

  return base;
}
