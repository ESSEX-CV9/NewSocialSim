import type { Fragment, LoadedPools, Pool } from '@socialsim/shared';

/**
 * 内容组装引擎（1.2，零 LLM）：给定一个池，按其语法拼出一条文本。
 *
 * 流程：按权重选一套语法 → 逐槽判定是否出现（optional / prob）→ 取一个片段
 *   （**池级覆盖优先、退回共享组件库**）→ 解析内联占位符 `{key}` / `{key:variant}` → 拼接。
 * 注入 RNG（[0,1)）即可复现；给定同一种子，输出确定。
 *
 * Phase 1 简化：片段在槽内**等权随机**抽（alignment / novelty / topicRelevance 加权待状态机层接真值）；
 * 占位符的 faction variant 暂按基础组件名解析（faction 注册表未建，variant 限定先忽略）。
 */

/** 占位符递归解析的安全深度上限（防自引用/环导致无限展开；机制护栏，非业务可调值）。 */
const MAX_PLACEHOLDER_DEPTH = 6;
/** 单槽内片段重抽上限（占位符解析不到时丢弃该候选重抽；护栏）。 */
const MAX_FRAGMENT_TRIES = 12;
/** 中性默认：调用方未提供时用 0.5（业务可调值应由调用方从 tuning 取后注入）。 */
const NEUTRAL_PROB = 0.5;

export interface AssembleContext {
  /** 已加载的组件库 / 语法库（占位符与槽取片段都查这里）。 */
  pools: LoadedPools;
  /** 随机源 [0,1)；注入种子化 RNG 即可复现。 */
  rng: () => number;
  /** prob 表达式里的变量值（如 slangDensity）；表达式引用未知变量时用 exprVarDefault。 */
  vars?: Record<string, number>;
  /** prob 表达式未知变量的默认值（调用方从 tuning 取）。 */
  exprVarDefault?: number;
  /** 标了 optional 但无 prob 的槽，出现概率（调用方从 tuning 取）。 */
  optionalProb?: number;
}

/** mulberry32：32 位种子 PRNG，返回 [0,1) 的取数函数，供复现。 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 组装一条内容；无可用语法或必填槽无法填充时返回 null（调用方降级：跳过本次发帖）。 */
export function assemble(pool: Pool, ctx: AssembleContext): string | null {
  const fragmentsFor = (name: string): Fragment[] => pool.fragments?.[name] ?? ctx.pools.components[name] ?? [];
  const exprVarDefault = ctx.exprVarDefault ?? NEUTRAL_PROB;
  const optionalProb = ctx.optionalProb ?? NEUTRAL_PROB;

  // 候选语法：存在于语法库、且每个必填槽（非 optional、无 prob）都有可用片段。
  const candidates = pool.grammars
    .map((g) => ({ ref: g.ref, weight: g.weight ?? 1, grammar: ctx.pools.grammars[g.ref] }))
    .filter((c) => c.grammar && c.weight > 0)
    .filter((c) =>
      c.grammar!.slots.every((s) => s.optional || s.prob !== undefined || fragmentsFor(s.component).length > 0),
    );
  if (!candidates.length) return null;

  const chosen = weightedPick(candidates, (c) => c.weight, ctx.rng);
  if (!chosen) return null;

  const parts: string[] = [];
  for (const slot of chosen.grammar!.slots) {
    // 出现判定：prob 优先；否则 optional 用 optionalProb；否则必出现。
    const appear =
      slot.prob !== undefined
        ? ctx.rng() < evalProb(slot.prob, ctx.vars, exprVarDefault)
        : slot.optional
          ? ctx.rng() < optionalProb
          : true;
    if (!appear) continue;

    const text = pickSlotText(slot.component, fragmentsFor, ctx);
    if (text === null) {
      // 取不到可用片段：必填槽则整条作废，可选槽则跳过。
      if (!slot.optional && slot.prob === undefined) return null;
      continue;
    }
    if (text) parts.push(text);
  }

  const out = parts.join('').trim();
  return out.length ? out : null;
}

/** 为某组件取一个片段并解析其占位符；候选解析不到则丢弃重抽，全失败返回 null。 */
function pickSlotText(
  component: string,
  fragmentsFor: (name: string) => Fragment[],
  ctx: AssembleContext,
): string | null {
  const frags = fragmentsFor(component);
  if (!frags.length) return null;
  for (let i = 0; i < MAX_FRAGMENT_TRIES; i++) {
    const frag = frags[Math.floor(ctx.rng() * frags.length)]!;
    const resolved = resolvePlaceholders(frag.text, fragmentsFor, ctx, 0);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** 解析文本中的 `{key}` / `{key:variant}` 内联组件引用；任一解析不到返回 null（让调用方丢弃重抽）。 */
function resolvePlaceholders(
  text: string,
  fragmentsFor: (name: string) => Fragment[],
  ctx: AssembleContext,
  depth: number,
): string | null {
  if (!text.includes('{')) return text;
  if (depth >= MAX_PLACEHOLDER_DEPTH) return null;

  let failed = false;
  const out = text.replace(/\{([^}:]+)(?::[^}]+)?\}/g, (_m, keyRaw: string) => {
    if (failed) return '';
    const key = keyRaw.trim();
    const frags = fragmentsFor(key);
    if (!frags.length) {
      failed = true;
      return '';
    }
    const frag = frags[Math.floor(ctx.rng() * frags.length)]!;
    const nested = resolvePlaceholders(frag.text, fragmentsFor, ctx, depth + 1);
    if (nested === null) {
      failed = true;
      return '';
    }
    return nested;
  });
  return failed ? null : out;
}

/** prob 取值：数字直用；字符串支持 `var` 或 `var * const`（var 取自 vars，缺省 varDefault）。 */
function evalProb(expr: number | string, vars: Record<string, number> | undefined, varDefault: number): number {
  if (typeof expr === 'number') return clamp01(expr);
  const s = expr.trim();
  const asNum = Number(s);
  if (Number.isFinite(asNum)) return clamp01(asNum);
  const m = s.match(/^([A-Za-z_]\w*)\s*(?:\*\s*([\d.]+))?$/);
  if (m) {
    const v = vars?.[m[1]!] ?? varDefault;
    const mult = m[2] ? Number(m[2]) : 1;
    return clamp01(v * mult);
  }
  return clamp01(varDefault);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 按权重抽一个；空数组返回 null。 */
function weightedPick<T>(items: T[], weightOf: (t: T) => number, rng: () => number): T | null {
  if (!items.length) return null;
  const total = items.reduce((s, it) => s + Math.max(0, weightOf(it)), 0);
  if (total <= 0) return items[0]!;
  let roll = rng() * total;
  for (const it of items) {
    roll -= Math.max(0, weightOf(it));
    if (roll < 0) return it;
  }
  return items[items.length - 1]!;
}
