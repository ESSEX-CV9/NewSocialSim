// 清空某世界的内容（帖子/互动/通知/私信/媒体引用）与决策轨迹，保留账号/关注/拉黑/话题/人设/内容池。
// 用法：node scripts/clean-world.mjs <worldId>
// 前提：先停掉 dev:server 与 dev:simulator（避免边清边写）。删前自动备份 world.db.bak-pre-clean。
import { createRequire } from 'node:module';
import { existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const worldId = process.argv[2];
if (!worldId) {
  console.error('用法：node scripts/clean-world.mjs <worldId>');
  process.exit(1);
}

const worldDir = path.resolve('data', 'worlds', worldId);
const worldDbPath = path.join(worldDir, 'world.db');
const traceDbPath = path.join(worldDir, 'sim-trace.db');
if (!existsSync(worldDbPath)) {
  console.error(`找不到世界库：${worldDbPath}`);
  process.exit(1);
}

// 要清空的内容表（保留 users / follows / blocks / topics）。
const CONTENT_TABLES = [
  'post_media', 'message_media', 'message_reactions', 'messages',
  'conversation_participants', 'conversations', 'link_cards', 'media',
  'likes', 'reposts', 'bookmarks', 'hidden_posts', 'notifications', 'posts',
];

function countSome(db, tables) {
  const out = {};
  for (const t of tables) {
    try { out[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { /* 表不存在则略过 */ }
  }
  return out;
}

// ---- world.db ----
{
  const db = new Database(worldDbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('wal_checkpoint(TRUNCATE)'); // 把 WAL 折回主库，确保备份与删除都作用于全量数据
  db.close();

  const bak = worldDbPath + '.bak-pre-clean';
  copyFileSync(worldDbPath, bak);
  console.log(`[备份] ${path.basename(bak)}`);

  const db2 = new Database(worldDbPath);
  db2.pragma('busy_timeout = 5000');
  db2.pragma('foreign_keys = OFF');
  const before = countSome(db2, ['posts', 'likes', 'reposts', 'notifications', 'messages', 'media']);

  const wipe = db2.transaction(() => {
    for (const t of CONTENT_TABLES) {
      try { db2.prepare(`DELETE FROM ${t}`).run(); } catch { /* 表不存在则略过 */ }
    }
    // 重置自增计数，让清后新内容从小 id 起。
    try {
      const names = CONTENT_TABLES.map(() => '?').join(',');
      db2.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${names})`).run(...CONTENT_TABLES);
    } catch { /* 无 sqlite_sequence 则略过 */ }
  });
  wipe();
  db2.exec('VACUUM');
  const after = countSome(db2, ['posts', 'likes', 'reposts', 'notifications', 'messages', 'media']);
  const users = db2.prepare('SELECT COUNT(*) c FROM users').get().c;
  db2.close();

  console.log('[world.db] 清理前：', before);
  console.log('[world.db] 清理后：', after, `（保留 users=${users}）`);
}

// ---- sim-trace.db（决策轨迹 + GM/Agent 日志）----
if (existsSync(traceDbPath)) {
  const td = new Database(traceDbPath);
  td.pragma('busy_timeout = 5000');
  td.pragma('wal_checkpoint(TRUNCATE)');
  const before = countSome(td, ['trace_event', 'gm_agent_log']);
  td.transaction(() => {
    for (const t of ['trace_event', 'gm_agent_log']) {
      try { td.prepare(`DELETE FROM ${t}`).run(); } catch { /* 表不存在则略过 */ }
    }
  })();
  td.exec('VACUUM');
  const after = countSome(td, ['trace_event', 'gm_agent_log']);
  td.close();
  console.log('[sim-trace.db] 清理前：', before);
  console.log('[sim-trace.db] 清理后：', after);
} else {
  console.log('[sim-trace.db] 不存在，略过');
}

console.log('\n完成。账号 / 关注 / 人设 / 内容池均保留；可重启 dev:server + dev:simulator 看干净时间线。');
