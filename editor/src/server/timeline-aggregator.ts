import type { InteractionEvent, Page, PostView, TimelineItem, UserSummary } from '@socialsim/shared';

/**
 * 时间轴聚合（T.3）：把"全站流 + 按账号回复/互动"的扇出合并从 renderer 搬到编辑器后端，
 * renderer 改吃单一接口 GET /api/timeline。
 *
 * **按可见时间窗口取数**：给 from/to 时，主轴顶层帖与各账号回复/互动都**在窗口内翻全**——
 * 因为社交站端点已支持 from/to（窗口有界，不会无限翻页），从而消除早期"只取最新 N 条"丢历史的问题。
 * 不给 from/to 时退回"最新一页 + 按账号封顶"（兜底/旧行为）。
 */

const FEED_LIMIT = 50;
const NO_WINDOW_CAP = 4; // 无区间时按账号封顶页数（兜底）
const WINDOW_CAP = 20; // 区间内翻页上限（窗口有界，足够取全；安全上限 20×50=1000/账号/窗口）

export interface AggregateOpts {
  cursor?: string | undefined;
  limit?: number | undefined;
  from?: number | undefined;
  to?: number | undefined;
  /** 限定扇出的账号（逗号列表解析后）；缺省 = 全部 roster。 */
  accounts?: string[] | undefined;
  /** 只取主轴顶层帖（跳过 roster 与按账号回复/互动扇出）——供无区间轮询轻量取数。 */
  axisOnly?: boolean | undefined;
}

export interface AggregateResult {
  /** 全部账号（时间轴轨道，含从未发帖者）。 */
  accounts: UserSummary[];
  /** 顶层帖 + 各账号回复；renderer 自行按 id 去重。 */
  posts: PostView[];
  /** 赞/转/关注事件（带 actor handle 与发生时间 at）。 */
  interactions: Array<{ actor: string; ev: InteractionEvent }>;
  /** 主轴 global 更老翻页游标（仅无区间模式有值，供向后无限滚动）。 */
  nextCursor: string | null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function fetchRoster(api: string): Promise<UserSummary[]> {
  const all: UserSummary[] = [];
  let cursor: string | undefined;
  for (let p = 0; p < 20; p++) {
    const u = new URL(`${api}/api/users`);
    u.searchParams.set('limit', '50');
    if (cursor) u.searchParams.set('cursor', cursor);
    const j = await getJson<Page<UserSummary>>(u.toString());
    if (!j) break;
    all.push(...j.items);
    if (!j.nextCursor) break;
    cursor = j.nextCursor;
  }
  return all;
}

/** 翻页拉一类游标列表，封顶 maxPages 页；extra 为附加 query（type / from / to 等）。 */
async function fetchPagedCapped<T>(
  api: string,
  basePath: string,
  extra: Record<string, string>,
  maxPages: number,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let p = 0; p < maxPages; p++) {
    const u = new URL(`${api}${basePath}`);
    u.searchParams.set('limit', '50');
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    if (cursor) u.searchParams.set('cursor', cursor);
    const j = await getJson<Page<T>>(u.toString());
    if (!j) break;
    out.push(...j.items);
    if (!j.nextCursor) break;
    cursor = j.nextCursor;
  }
  return out;
}

export async function aggregateTimeline(api: string, opts: AggregateOpts): Promise<AggregateResult> {
  const windowed = opts.from != null || opts.to != null;
  const rangeParams: Record<string, string> = {};
  if (opts.from != null) rangeParams.from = String(Math.round(opts.from));
  if (opts.to != null) rangeParams.to = String(Math.round(opts.to));

  // 主轴：全站顶层帖。窗口模式翻全；否则单页 + 游标（供无限滚动）。
  let posts: PostView[];
  let nextCursor: string | null;
  if (windowed) {
    const items = await fetchPagedCapped<TimelineItem>(api, '/api/timeline/global', rangeParams, WINDOW_CAP);
    posts = items.filter((it) => it.type === 'post').map((it) => it.post);
    nextCursor = null;
  } else {
    const gu = new URL(`${api}/api/timeline/global`);
    gu.searchParams.set('limit', String(opts.limit ?? FEED_LIMIT));
    if (opts.cursor) gu.searchParams.set('cursor', opts.cursor);
    const g = await getJson<Page<TimelineItem>>(gu.toString());
    posts = (g?.items ?? []).filter((it) => it.type === 'post').map((it) => it.post);
    nextCursor = g?.nextCursor ?? null;
  }

  if (opts.axisOnly) {
    return { accounts: [], posts, interactions: [], nextCursor };
  }

  const roster = await fetchRoster(api);
  const handles = opts.accounts?.length ? opts.accounts : roster.map((a) => a.handle);
  const cap = windowed ? WINDOW_CAP : NO_WINDOW_CAP;

  // 各账号回复 + 互动并发扇出（窗口模式服务端按 from/to 过滤，取全窗口内容、无 200 封顶丢历史）
  const interactions: Array<{ actor: string; ev: InteractionEvent }> = [];
  const per = await Promise.all(
    handles.map(async (h) => {
      const enc = encodeURIComponent(h);
      const [reps, ints] = await Promise.all([
        fetchPagedCapped<PostView>(api, `/api/users/${enc}/posts`, { type: 'replies', ...rangeParams }, cap),
        fetchPagedCapped<InteractionEvent>(api, `/api/users/${enc}/interactions`, rangeParams, cap),
      ]);
      return { reps, ints, h };
    }),
  );
  for (const { h, reps, ints } of per) {
    posts.push(...reps);
    for (const ev of ints) interactions.push({ actor: h, ev });
  }

  return { accounts: roster, posts, interactions, nextCursor };
}
