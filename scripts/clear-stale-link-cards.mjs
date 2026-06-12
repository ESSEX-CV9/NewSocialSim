// 一次性维护脚本：清除 bilibili（糊图旧缓存）与 youtube/pinterest（失败缓存）的
// link_cards 条目，下一次有帖子引用同 URL 时按新逻辑重新抓取。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db = new Database('data/worlds/modern-earth/world.db');
db.pragma('busy_timeout = 3000');
const result = db
  .prepare(
    `DELETE FROM link_cards
     WHERE url LIKE '%bilibili.com%' OR url LIKE '%youtube.com%' OR url LIKE '%youtu.be%'
        OR url LIKE '%pinterest.%' OR status = 'failed'`,
  )
  .run();
console.log(`deleted ${result.changes} stale link_cards rows`);
db.close();
