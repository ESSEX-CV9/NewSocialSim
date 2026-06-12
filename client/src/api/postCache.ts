import type { PostView } from '@socialsim/shared';
import type { QueryClient } from '@tanstack/react-query';

/**
 * 帖子缓存写穿：互动 mutation 成功后，把服务端返回的状态写进所有含 PostView 的
 * 查询缓存，使各页面（时间线/详情/书签/搜索…）即时同步，不依赖 refetch。
 *
 * 约定：凡新增"数据中含 PostView"的查询，必须把其 queryKey 首元素登记到
 * POST_QUERY_HEADS，否则该查询不参与写穿。
 */
const POST_QUERY_HEADS = new Set([
  'timeline', // InfiniteData<Page<TimelineItem>>
  'user-timeline', // InfiniteData<Page<TimelineItem>>
  'user-posts', // InfiniteData<Page<PostView>>
  'user-likes', // InfiniteData<Page<PostView>>
  'user-media', // InfiniteData<Page<PostView>>
  'bookmarks', // InfiniteData<Page<PostView>>
  'search-posts', // InfiniteData<Page<PostView>>
  'replies', // InfiniteData<Page<PostView>>
  'post', // { post: PostView }
]);

type PostPatch = (p: PostView) => Partial<PostView>;

/** 命中则返回新对象，未命中返回原引用；.quoted 嵌套独立判定 */
function patchOnePost(p: PostView, match: (p: PostView) => boolean, patch: PostPatch): PostView {
  let next = match(p) ? { ...p, ...patch(p) } : p;
  if (p.quoted) {
    const quoted = patchOnePost(p.quoted, match, patch);
    if (quoted !== p.quoted) next = next === p ? { ...p, quoted } : { ...next, quoted };
  }
  return next;
}

function isPostView(value: unknown): value is PostView {
  return typeof value === 'object' && value !== null && 'likedByViewer' in value;
}

/** 列表元素：TimelineItem（含 post 字段）或裸 PostView */
function patchListItem(item: unknown, match: (p: PostView) => boolean, patch: PostPatch): unknown {
  if (typeof item !== 'object' || item === null) return item;
  if ('post' in item && isPostView((item as { post: unknown }).post)) {
    const wrapped = item as { post: PostView };
    const post = patchOnePost(wrapped.post, match, patch);
    return post === wrapped.post ? item : { ...wrapped, post };
  }
  if (isPostView(item)) return patchOnePost(item, match, patch);
  return item;
}

/**
 * 对所有含 PostView 的缓存做不可变写穿。
 * 仅命中项新建对象链；整条查询无命中时返回 undefined（react-query 跳过更新）。
 */
export function patchPostsInCache(
  qc: QueryClient,
  match: (p: PostView) => boolean,
  patch: PostPatch,
): void {
  qc.setQueriesData<unknown>(
    { predicate: (q) => POST_QUERY_HEADS.has(q.queryKey[0] as string) },
    (data: unknown) => {
      if (typeof data !== 'object' || data === null) return undefined;

      // InfiniteData<Page<TimelineItem | PostView>>
      if ('pages' in data && Array.isArray((data as { pages: unknown }).pages)) {
        const infinite = data as { pages: { items: unknown[] }[]; pageParams: unknown[] };
        let pagesChanged = false;
        const pages = infinite.pages.map((page) => {
          let itemsChanged = false;
          const items = page.items.map((item) => {
            const next = patchListItem(item, match, patch);
            if (next !== item) itemsChanged = true;
            return next;
          });
          if (!itemsChanged) return page;
          pagesChanged = true;
          return { ...page, items };
        });
        return pagesChanged ? { ...infinite, pages } : undefined;
      }

      // ['post', id] → { post: PostView }
      if ('post' in data && isPostView((data as { post: unknown }).post)) {
        const wrapped = data as { post: PostView };
        const post = patchOnePost(wrapped.post, match, patch);
        return post === wrapped.post ? undefined : { ...wrapped, post };
      }

      return undefined;
    },
  );
}

/** 按帖子 id 写穿 */
export function patchPostById(qc: QueryClient, postId: number, patch: PostPatch): void {
  patchPostsInCache(qc, (p) => p.id === postId, patch);
}

/** 按作者 id 写穿全部帖子的"已关注作者"状态 */
export function patchAuthorFollow(qc: QueryClient, authorId: number, following: boolean): void {
  patchPostsInCache(
    qc,
    (p) => p.authorId === authorId && p.authorFollowedByViewer !== following,
    () => ({ authorFollowedByViewer: following }),
  );
}
