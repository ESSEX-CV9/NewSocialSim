import type { InteractionEvent, Page, PostView, TimelineItem, UserSummary } from '@socialsim/shared';

/**
 * 时间轴聚合（T.3）：把"全站流 + 按账号回复/互动"的扇出合并从 renderer 搬到编辑器后端，
 * renderer 改吃单一接口 GET /api/timeline。**稳定接口、内部实现可后续优化**——
 * 当前用社交站现有端点（global from/to + 按账号 capped 回复/互动）拼装，
 * 待服务端补全局回复/互动 by-time 后只动此处、不动 renderer。
 */

const FEED_LIMIT = 50;
const EXTRA_PAGE_CAP = 4; // 每账号回复/互动拉取页数上限（深度历史待服务端区间端点）

export interface AggregateOpts {
  cursor?: string | undefined;
  limit?: number | undefined;
  from?: number | undefined;
  to?: number | undefined;
  /** 限定扇出的账号（逗号列表解析后）；缺省 = 全部 roster。 */
  accounts?: string[] | undefined;
  /** 只取主轴顶层帖（跳过 roster 与按账号回复/互动扇出）——供向后翻页/轮询轻量取数。 */
  axisOnly?: boolean | undefined;
}

export interface AggregateResult {
  /** 全部账号（时间轴轨道，含从未发帖者）。 */
  accounts: UserSummary[];
  /** 顶层帖（global 窗口）+ 各账号回复（capped）；renderer 自行按 id 去重。 */
  posts: PostView[];
  /** 赞/转/关注事件（带 actor handle 与发生时间 at）。 */
  interactions: Array<{ actor: string; ev: InteractionEvent }>;
  /** 主轴 global 更老翻页游标（向后无限滚动用）。 */
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

/** 按账号拉一类游标列表，封顶 EXTRA_PAGE_CAP 页。 */
async function fetchPagedCapped<T>(api: string, pathAndQuery: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let p = 0; p < EXTRA_PAGE_CAP; p++) {
    const u = new URL(`${api}${pathAndQuery}`);
    u.searchParams.set('limit', '50');
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
  // 主轴：全站顶层帖（窗口 from/to + 游标，T.2）。axisOnly 时只取这一项。
  const gu = new URL(`${api}/api/timeline/global`);
  gu.searchParams.set('limit', String(opts.limit ?? FEED_LIMIT));
  if (opts.cursor) gu.searchParams.set('cursor', opts.cursor);
  if (opts.from != null) gu.searchParams.set('from', String(Math.round(opts.from)));
  if (opts.to != null) gu.searchParams.set('to', String(Math.round(opts.to)));
  const g = await getJson<Page<TimelineItem>>(gu.toString());
  const posts: PostView[] = (g?.items ?? []).filter((it) => it.type === 'post').map((it) => it.post);
  const nextCursor = g?.nextCursor ?? null;

  if (opts.axisOnly) {
    return { accounts: [], posts, interactions: [], nextCursor };
  }

  const roster = await fetchRoster(api);
  const handles = opts.accounts?.length ? opts.accounts : roster.map((a) => a.handle);

  // 区间过滤（仅当给了 from/to；回复/互动按账号 capped 后客户端过滤）
  const inRange = (t: number): boolean =>
    (opts.from == null || t >= opts.from) && (opts.to == null || t <= opts.to);

  // 各账号回复 + 互动并发扇出
  const interactions: Array<{ actor: string; ev: InteractionEvent }> = [];
  const per = await Promise.all(
    handles.map(async (h) => {
      const enc = encodeURIComponent(h);
      const [reps, ints] = await Promise.all([
        fetchPagedCapped<PostView>(api, `/api/users/${enc}/posts?type=replies`),
        fetchPagedCapped<InteractionEvent>(api, `/api/users/${enc}/interactions`),
      ]);
      return {
        h,
        reps: reps.filter((p) => inRange(p.createdAt)),
        ints: ints.filter((ev) => inRange(ev.at)),
      };
    }),
  );
  for (const { h, reps, ints } of per) {
    posts.push(...reps);
    for (const ev of ints) interactions.push({ actor: h, ev });
  }

  return { accounts: roster, posts, interactions, nextCursor };
}
