import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { SimulatorConfig } from './ecs/types.js';

const DEFAULT_CONTENT_POOL = [
  '今天天气真好啊',
  '有没有人推荐点好看的电影',
  '刚吃完午饭，好撑',
  '工作好累，想摸鱼',
  '周末有什么计划吗',
  '这首歌也太好听了吧',
  '分享一下今天的心情',
  '有人一起打游戏吗',
  '今天的新闻看了吗',
  '好想出去旅游',
  '最近在追的剧太上头了',
  '早起的第一杯咖啡',
  '深夜emo时间',
  '又到了减肥的季节',
  '有什么好书推荐的吗',
  '今天加班到现在',
  '这个周末终于可以休息了',
  '猫猫好可爱啊',
  '刚看完一部纪录片，推荐大家看看',
  '今天的落日好美',
];

export function loadConfig(configPath?: string): SimulatorConfig {
  if (configPath && existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw) as Partial<SimulatorConfig>;
    return {
      apiBaseUrl: parsed.apiBaseUrl ?? 'http://127.0.0.1:3000',
      worldId: parsed.worldId ?? 'default',
      tickIntervalMs: parsed.tickIntervalMs ?? 10_000,
      accounts: parsed.accounts ?? [],
      contentPool: parsed.contentPool ?? DEFAULT_CONTENT_POOL,
    };
  }

  return {
    apiBaseUrl: 'http://127.0.0.1:3000',
    worldId: 'default',
    tickIntervalMs: 10_000,
    accounts: [
      { handle: 'alice', password: 'secret123', tier: 'core', interests: ['photography', 'tech'] },
      { handle: 'bob', password: 'secret123', tier: 'core', interests: ['gaming', 'music'] },
      { handle: 'carol', password: 'secret123', tier: 'ambient' },
      { handle: 'dave', password: 'secret123', tier: 'ambient' },
    ],
    contentPool: DEFAULT_CONTENT_POOL,
  };
}
