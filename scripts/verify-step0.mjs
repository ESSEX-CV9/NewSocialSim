// Step 0 金标准端到端验收（断言式）。依据 docs/m5-real-usage-contract.md 金标准场景的
// Step-0 子集：现建两个全新世界、代理建号(is_bot+拒绝bot命名)、世界自包含配置、模拟器跟随
// 活动世界、切世界 flush/重登/不写旧世界、切回恢复。Step5(回复挂父帖/媒体/alignment 语气)
// 属 Phase 1-3，本脚本不验。跑完恢复原活动世界并删除测试世界。失败退码 1。
//
// 前置：后端已启动（npm run dev:server）；本脚本会自起一个模拟器子进程，故运行期间
// 不要另开 npm run dev:simulator（否则两个模拟器同时驱动会互相干扰）。
// 用法：node scripts/verify-step0.mjs    （用 node 直接跑，避开 tsx 对含中文 .mjs 的预扫描坑）

import { spawn } from 'node:child_process';
import path from 'node:path';
import Database from 'better-sqlite3';

const BASE = process.env.SOCIALSIM_API_URL ?? 'http://127.0.0.1:3000';
const AK = process.env.SOCIALSIM_ADMIN_KEY ?? 'dev-admin-key';
const TS = Date.now().toString(36);
const W1 = `s0a${TS}`;
const W2 = `s0b${TS}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, p, body) {
  const headers = { Authorization: `Bearer ${AK}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await res.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { ok: res.ok, status: res.status, body: d, raw: t };
}
async function apiOrThrow(method, p, body) {
  const r = await api(method, p, body);
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${String(r.raw).slice(0, 160)}`);
  return r.body;
}

/** 只读直查某世界 world.db 的帖子数（跨活动世界，用于"W2 期间不写 W1"断言）。 */
function countPosts(worldId) {
  const f = path.join('data', 'worlds', worldId, 'world.db');
  try {
    const db = new Database(f, { readonly: true, fileMustExist: true });
    const n = db.prepare('SELECT COUNT(*) AS c FROM posts').get().c;
    db.close();
    return n;
  } catch {
    return -1;
  }
}

async function getStatus() {
  const r = await api('GET', '/api/simulator/status');
  return r.ok ? r.body : null;
}
/** 轮询直到 predicate(status) 为真或超时。 */
async function waitForStatus(pred, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await getStatus();
    if (s && pred(s)) return s;
    await sleep(1500);
  }
  console.log(`  (等待超时：${label})`);
  return await getStatus();
}

async function setupWorld(id, name, accounts, poolKey, poolItems) {
  await apiOrThrow('POST', '/api/admin/worlds', {
    id, name, locale: 'zh-CN', contentRating: 'all', clock: { scale: 120, paused: false },
  });
  await apiOrThrow('POST', `/api/admin/worlds/${id}/activate`);
  for (const a of accounts) {
    const r = await api('POST', '/api/admin/users', { handle: a.handle, displayName: a.displayName });
    if (!r.ok) throw new Error(`建号 @${a.handle} 失败：${r.status} ${r.raw}`);
    await apiOrThrow('PUT', `/api/admin/npc-profiles/${r.body.id}`, {
      tier: a.tier, interests: [poolKey],
      activeHoursStart: 0, activeHoursEnd: 24,
      postProbability: 1, likeProbability: 0.3, repostProbability: 0.1, replyProbability: 0.2,
      actionIntervalMinutes: 1,
    });
  }
  try { await api('DELETE', `/api/admin/content-pools/scene/${encodeURIComponent(poolKey)}`); } catch { /* 新世界本无 */ }
  await apiOrThrow('POST', '/api/admin/content-pools', { poolType: 'scene', key: poolKey, items: poolItems });
}

async function main() {
  console.log(`Step 0 验收：W1=${W1} W2=${W2}\n`);
  const original = (await api('GET', '/api/admin/worlds/active')).body?.meta?.id ?? null;
  console.log(`原活动世界=${original}（跑完恢复）\n`);

  let sim = null;
  try {
    // --- 1. 建 W1 + 激活 ---
    console.log('[1] 建并激活 W1');
    await setupWorld(W1, 'Step0 世界 A', [
      { handle: 'muyunphoto', displayName: '慕云', tier: 'core' },
      { handle: 'axiaodaily', displayName: '阿萧', tier: 'ambient' },
      { handle: 'tinacafe', displayName: '蒂娜', tier: 'ambient' },
    ], 'daily', ['morning run done', 'coffee time', 'street shots today', 'late night snack']);
    const act1 = await api('GET', '/api/admin/worlds/active');
    check('W1 创建并成为活动世界', act1.body?.meta?.id === W1, `active=${act1.body?.meta?.id}`);

    // --- 2. 账号模型：is_bot=1 ---
    const users1 = (await apiOrThrow('GET', '/api/admin/users')).users;
    const driven = users1.filter((u) => ['muyunphoto', 'axiaodaily', 'tinacafe'].includes(u.handle));
    check('代理建号 3 个账号', driven.length === 3, `found=${driven.length}`);
    check('驱动账号全部 is_bot=1', driven.length === 3 && driven.every((u) => u.isBot === 1));

    // --- 3. 账号模型：拒绝暴露虚拟身份的命名 ---
    console.log('[3] 命名拒绝');
    const badNames = ['sim_test', 'newsbot', 'npc_a', 'user01'];
    for (const h of badNames) {
      const r = await api('POST', '/api/admin/users', { handle: h, displayName: 'X' });
      check(`拒绝 bot 命名 @${h}`, !r.ok, `status=${r.status}`);
    }

    // --- 4. 启动模拟器（启动参数不含 W1 内容数据），跟随活动世界 ---
    console.log('[4] 启动模拟器（跟随活动世界）');
    sim = spawn(process.execPath, ['--import', 'tsx', 'simulator/src/index.ts'], { cwd: process.cwd() });
    sim.stdout.on('data', (d) => process.stdout.write(`  [sim] ${d}`));
    sim.stderr.on('data', (d) => process.stdout.write(`  [sim] ${d}`));
    const s4 = await waitForStatus((s) => s.running && s.boundWorldId === W1 && s.accountCount === 3, 40000, '模拟器绑定 W1');
    check('模拟器绑定 W1 并登录 3 账号', s4?.boundWorldId === W1 && s4?.accountCount === 3, `bound=${s4?.boundWorldId} accts=${s4?.accountCount}`);

    // --- 5(子集). W1 开始有帖 ---
    const w1c0 = countPosts(W1);
    const grew1 = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) { if (countPosts(W1) > w1c0) return true; await sleep(2000); }
      return false;
    })();
    check('W1 运转后产生帖子', grew1, `posts ${w1c0} -> ${countPosts(W1)}`);

    // --- 6. 激活 W2：flush W1、重登 W2、写 W2、不写 W1 ---
    console.log('[6] 建 W2 并切换');
    await setupWorld(W2, 'Step0 世界 B', [
      { handle: 'leofilm', displayName: '里奥', tier: 'core' },
      { handle: 'sukeats', displayName: '小苏', tier: 'ambient' },
      { handle: 'realken', displayName: '老肯', tier: 'ambient' },
    ], 'daily', ['gym session', 'new recipe tried', 'weekend trip plan', 'bug finally fixed']);
    await apiOrThrow('POST', `/api/admin/worlds/${W2}/activate`);
    const s6 = await waitForStatus((s) => s.boundWorldId === W2 && s.accountCount === 3, 30000, '模拟器绑定 W2');
    check('切到 W2 后模拟器 flush 了 W1', s6?.lastFlushedWorldId === W1, `lastFlushed=${s6?.lastFlushedWorldId}`);
    check('模拟器重登 W2（绑定 W2 / 3 账号）', s6?.boundWorldId === W2 && s6?.accountCount === 3, `bound=${s6?.boundWorldId} accts=${s6?.accountCount}`);
    await sleep(2000); // 让切换中可能的在途写入落定
    const w1Before = countPosts(W1);
    const w2c0 = countPosts(W2);
    const grew2 = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) { if (countPosts(W2) > w2c0) return true; await sleep(2000); }
      return false;
    })();
    check('W2 用其配置发帖', grew2, `W2 posts ${w2c0} -> ${countPosts(W2)}`);
    check('W2 期间不写 W1（无 401 空转/串写）', countPosts(W1) === w1Before, `W1 posts ${w1Before} -> ${countPosts(W1)}`);

    // --- 7. 切回 W1：恢复驱动 ---
    console.log('[7] 切回 W1');
    await apiOrThrow('POST', `/api/admin/worlds/${W1}/activate`);
    const s7 = await waitForStatus((s) => s.boundWorldId === W1 && s.accountCount === 3, 30000, '模拟器绑回 W1');
    check('切回后模拟器重绑 W1', s7?.boundWorldId === W1 && s7?.accountCount === 3, `bound=${s7?.boundWorldId}`);
    const w1c1 = countPosts(W1);
    const grew3 = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) { if (countPosts(W1) > w1c1) return true; await sleep(2000); }
      return false;
    })();
    check('切回后 W1 恢复发帖', grew3, `W1 posts ${w1c1} -> ${countPosts(W1)}`);
  } finally {
    // --- 收尾：停模拟器、恢复原活动世界、删测试世界 ---
    console.log('\n[cleanup] 停模拟器、恢复原活动世界、删测试世界');
    if (sim) { sim.kill(); await sleep(1500); }
    if (original) { try { await api('POST', `/api/admin/worlds/${original}/activate`); } catch { /* ignore */ } }
    for (const id of [W1, W2]) {
      const r = await api('DELETE', `/api/admin/worlds/${id}`);
      console.log(`  删 ${id}: ${r.ok ? 'ok' : `失败 ${r.status}`}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log('失败项：' + failed.map((f) => f.name).join('；'));
    process.exit(1);
  }
  console.log('Step 0 金标准（子集）全部通过。');
  process.exit(0);
}

main().catch((e) => { console.error('验收脚本异常：', e); process.exit(1); });
