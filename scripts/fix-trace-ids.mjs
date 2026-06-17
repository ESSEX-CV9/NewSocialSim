/**
 * 一次性数据订正：把各世界 sim-trace.db 中 target_post_id / post_id 的浮点表示（如 "3193.0"）
 * 规整成整数串（"3193"）。成因是早期互动系统把 API 返回的浮点 id 原样写入轨迹，
 * 导致决策轨迹与帖子块对不上。源头已在 simulator/src/ids.ts 修复；本脚本修历史脏数据，跑完即了。
 *
 * 用法：node scripts/fix-trace-ids.mjs
 * 前提：先停掉 dev:simulator（避免写锁冲突 / 边修边产生新脏数据）。
 */
import Database from 'better-sqlite3';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const WORLDS_DIR = path.resolve('data', 'worlds');
if (!existsSync(WORLDS_DIR)) {
  console.error('找不到 data/worlds，请在仓库根目录运行。');
  process.exit(1);
}

let totalFixed = 0;
for (const world of readdirSync(WORLDS_DIR)) {
  const dbPath = path.join(WORLDS_DIR, world, 'sim-trace.db');
  if (!existsSync(dbPath)) continue;
  let db;
  try {
    db = new Database(dbPath);
    db.pragma('busy_timeout = 3000');
    const before = db.prepare("SELECT COUNT(*) c FROM trace_event WHERE target_post_id LIKE '%.%' OR post_id LIKE '%.%'").get().c;
    const fix = db.transaction(() => {
      db.prepare("UPDATE trace_event SET target_post_id = CAST(CAST(target_post_id AS INTEGER) AS TEXT) WHERE target_post_id LIKE '%.%'").run();
      db.prepare("UPDATE trace_event SET post_id = CAST(CAST(post_id AS INTEGER) AS TEXT) WHERE post_id LIKE '%.%'").run();
    });
    fix();
    const after = db.prepare("SELECT COUNT(*) c FROM trace_event WHERE target_post_id LIKE '%.%' OR post_id LIKE '%.%'").get().c;
    console.log(`[${world}] 修正 ${before} 行 → 剩余浮点 ${after}`);
    totalFixed += before;
  } catch (err) {
    console.error(`[${world}] 跳过（${err instanceof Error ? err.message : err}）——可能 dev:simulator 仍在运行，请先停止后重试。`);
  } finally {
    if (db) db.close();
  }
}
console.log(`完成，共修正 ${totalFixed} 行。`);
