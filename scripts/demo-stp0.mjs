// Step 0 演示：模拟器跟随活动世界 + 登录 + 发帖 + 切世界自动换班。
// 用 node 直接跑（避免 tsx 对含中文 .mjs 的预扫描坑：本文件全中文字符串走 node 原生 UTF-8，不经 tsx）。
import { spawn } from 'node:child_process';

const BASE = 'http://127.0.0.1:3000';
const AK = 'dev-admin-key';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const headers = { Authorization: `Bearer ${AK}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await res.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${String(t).slice(0, 160)}`);
  return d;
}

async function ensureWorld(id, name, scale) {
  try {
    await api('POST', '/api/admin/worlds', { id, name, locale: 'zh-CN', contentRating: 'all', clock: { scale, paused: false } });
    console.log(`[setup] 创建世界 ${id}`);
  } catch {
    console.log(`[setup] 世界 ${id} 已存在`);
  }
}

async function ensureBot(handle, displayName, tier, interests) {
  let id;
  try {
    const u = await api('POST', '/api/admin/users', { handle, displayName });
    id = u.id;
  } catch {
    const l = await api('GET', '/api/admin/users');
    id = l.users.find((x) => x.handle === handle)?.id;
  }
  await api('PUT', `/api/admin/npc-profiles/${id}`, {
    tier, interests,
    activeHoursStart: 0, activeHoursEnd: 24,
    postProbability: 0.8, likeProbability: 0.5, repostProbability: 0.15, replyProbability: 0.1,
    actionIntervalMinutes: 3,
  });
  console.log(`[setup] 账号 @${handle} #${id}（${tier}）+ 档案`);
  return id;
}

async function setPool(key, items) {
  try { await api('DELETE', `/api/admin/content-pools/scene/${encodeURIComponent(key)}`); } catch {}
  await api('POST', '/api/admin/content-pools', { poolType: 'scene', key, items });
}

async function main() {
  // ---- 建世界 + 账号 + 场景池 ----
  await ensureWorld('demo', '演示世界', 5);
  await api('POST', '/api/admin/worlds/demo/activate');
  await ensureBot('linchen_ph', '林辰', 'core', ['摄影', '旅行']);
  await ensureBot('yoyo_eats', '悠悠', 'ambient', ['美食']);
  await ensureBot('techmaru', '丸子', 'ambient', ['科技', '数码']);
  await setPool('摄影', ['今天去拍了日落，光线绝了', '新镜头到手先来组街拍', '逆光人像太吃后期', '分享几张最近的废片']);
  await setPool('美食', ['这家拉面汤头绝了', '自己煮的火锅yyds', '打卡一家新开的咖啡店', '深夜放毒：烤串配啤酒']);
  await setPool('科技', ['新机上手续航有点拉', '这代芯片提升不大', '折腾一下午把环境配好了', '这AI工具是真好用']);
  await ensureWorld('demo2', '空白对照世界', 1);
  await api('POST', '/api/admin/worlds/demo/activate'); // 确保当前世界 = demo
  console.log('[setup] 完成，当前活动世界 = demo\n');

  // ---- 启动模拟器（直接 node 子进程，便于干净停止）----
  const sim = spawn(process.execPath, ['--import', 'tsx', 'simulator/src/index.ts'], { cwd: process.cwd() });
  sim.stdout.on('data', (d) => process.stdout.write(d));
  sim.stderr.on('data', (d) => process.stdout.write(d));

  await sleep(25000); // 跑两三个 tick：绑定 demo、登录 3 账号、开始发帖
  console.log('\n>>> 切到空白世界 demo2（应见：flush demo、绑定 demo2、0 账号空转）');
  await api('POST', '/api/admin/worlds/demo2/activate');
  await sleep(13000);
  console.log('\n>>> 切回 demo（应见：flush demo2、重新绑定 demo、恢复发帖）');
  await api('POST', '/api/admin/worlds/demo/activate');
  await sleep(15000);

  console.log('\n>>> 演示结束，停止模拟器');
  sim.kill();
  await sleep(1200);

  // ---- 收尾：删 demo2、保留 demo、打印 demo 帖子 ----
  try { await api('DELETE', '/api/admin/worlds/demo2'); console.log('[cleanup] 删除 demo2'); }
  catch (e) { console.log('[cleanup] 删 demo2 失败：', e.message); }
  await api('POST', '/api/admin/worlds/demo/activate');

  const tl = await api('GET', '/api/timeline/global?limit=20');
  console.log(`\n[结果] demo 全站时间线现有 ${tl.items.length} 条帖子：`);
  for (const it of tl.items.slice(0, 14)) {
    const p = it.post ?? it;
    console.log(`  @${p.author?.handle}（${p.author?.displayName}）: ${(p.content || '').slice(0, 28)}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('演示失败：', e); process.exit(1); });
