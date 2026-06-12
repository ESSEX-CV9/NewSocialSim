import type { CreatePostRequest, Page, PostView, UserSummary } from '@socialsim/shared';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/app-error.js';
import { decodeTsIdCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { extractFirstUrl, type LinkCardsService } from '../link-cards/link-cards.service.js';
import type { MediaService } from '../media/media.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { UsersService } from '../users/users.service.js';
import { postsRepo, type CountDeltas, type PostRow } from './posts.repo.js';

const MAX_CONTENT_LENGTH = 280;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export class PostsService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly mediaService: MediaService,
    private readonly linkCardsService: LinkCardsService,
  ) {}

  async create(authorId: number, input: CreatePostRequest): Promise<PostView> {
    const content = input.content.trim();
    const mediaIds = input.mediaIds ?? [];
    // 有媒体时允许纯图无文字（与 X 一致）
    if (content.length === 0 && mediaIds.length === 0) throw new ValidationError('内容不能为空');
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new ValidationError(`内容最长 ${MAX_CONTENT_LENGTH} 字符`);
    }
    if (input.replyToId !== undefined && input.quoteOfId !== undefined) {
      throw new ValidationError('一条帖子不能同时是回复和引用');
    }
    this.mediaService.validateAttachable(authorId, mediaIds);

    // 正文首个 URL 预抓 OG 卡片（内部吞错，失败不阻断发帖）
    const firstUrl = extractFirstUrl(content);
    if (firstUrl !== null && mediaIds.length === 0) {
      await this.linkCardsService.resolve(firstUrl, authorId);
    }

    const { db, clock } = this.worldManager.current();
    const parent = input.replyToId !== undefined ? this.getLiveRow(input.replyToId) : null;
    const quoted = input.quoteOfId !== undefined ? this.getLiveRow(input.quoteOfId) : null;

    const id = db.transaction(() => {
      const now = clock.now();
      const postId = postsRepo.insert(db, {
        authorId,
        content,
        replyToId: parent?.id ?? null,
        quoteOfId: quoted?.id ?? null,
        createdAt: now,
      });
      if (mediaIds.length > 0) {
        this.mediaService.attachToPost(postId, mediaIds);
      }
      if (parent) {
        postsRepo.adjustCounts(db, parent.id, { reply: 1 });
        this.notificationsService.add({
          userId: parent.author_id,
          type: 'reply',
          actorId: authorId,
          postId,
        });
      }
      if (quoted) {
        postsRepo.adjustCounts(db, quoted.id, { quote: 1 });
        this.notificationsService.add({
          userId: quoted.author_id,
          type: 'quote',
          actorId: authorId,
          postId,
        });
      }
      // @mention：被回复/被引用作者已各有通知，不再重复
      const alreadyNotified = new Set([authorId, parent?.author_id, quoted?.author_id]);
      for (const userId of this.resolveMentions(content)) {
        if (alreadyNotified.has(userId)) continue;
        this.notificationsService.add({ userId, type: 'mention', actorId: authorId, postId });
      }
      return postId;
    })();
    return this.getView(id, authorId);
  }

  /** 解析正文中的 @handle，返回真实存在的用户 id（去重） */
  private resolveMentions(content: string): number[] {
    const handles = new Set(
      [...content.matchAll(/@([a-zA-Z0-9_]{2,20})/g)].map((m) => m[1]!),
    );
    const ids: number[] = [];
    for (const handle of handles) {
      const id = this.usersService.findIdByHandle(handle);
      if (id !== null) ids.push(id);
    }
    return ids;
  }

  /** 帖子详情；已删除的帖子返回墓碑（保持对话串可导航） */
  getView(postId: number, viewerId: number | null): PostView {
    const { db } = this.worldManager.current();
    const row = postsRepo.findById(db, postId);
    if (!row) throw new NotFoundError(`帖子 #${postId} 不存在`);
    const [view] = this.buildViews([row], viewerId);
    return view!;
  }

  listReplies(postId: number, viewerId: number | null, cursor?: string, limit?: number): Page<PostView> {
    this.getLiveRow(postId);
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = postsRepo.listReplies(db, postId, viewerId, decodeTsIdCursor(cursor), pageSize + 1);
    return this.toPage(rows, pageSize, viewerId);
  }

  listByHandle(
    handle: string,
    viewerId: number | null,
    cursor?: string,
    limit?: number,
    type: 'posts' | 'replies' = 'posts',
  ): Page<PostView> {
    const profile = this.usersService.getProfileByHandle(handle);
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = postsRepo.listByAuthor(
      db,
      profile.id,
      type === 'replies',
      decodeTsIdCursor(cursor),
      pageSize + 1,
    );
    const page = this.toPage(rows, pageSize, viewerId);
    if (type === 'replies') this.attachParents(page.items, viewerId);
    return page;
  }

  /** 回复 Tab：给每条回复嵌入一层被回复帖（观察者不可见时只留作者 handle 供降级显示） */
  private attachParents(items: PostView[], viewerId: number | null): void {
    const parentIds = [
      ...new Set(items.map((v) => v.replyToId).filter((id): id is number => id !== null)),
    ];
    if (parentIds.length === 0) return;
    const { db } = this.worldManager.current();
    const handleById = new Map(
      postsRepo.findByIds(db, parentIds).map((r) => [r.id, r.author_handle]),
    );
    const visibleRows = postsRepo.findVisibleByIds(db, parentIds, viewerId);
    const visibleViews = new Map(this.buildViews(visibleRows, viewerId).map((v) => [v.id, v]));
    for (const item of items) {
      if (item.replyToId === null) continue;
      item.inReplyTo = visibleViews.get(item.replyToId) ?? null;
      item.replyToHandle = handleById.get(item.replyToId) ?? null;
    }
  }

  /** 某用户带媒体的帖子（个人主页媒体 Tab） */
  listMediaByHandle(
    handle: string,
    viewerId: number | null,
    cursor?: string,
    limit?: number,
  ): Page<PostView> {
    const profile = this.usersService.getProfileByHandle(handle);
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = postsRepo.listMediaPostsByAuthor(
      db,
      profile.id,
      decodeTsIdCursor(cursor),
      pageSize + 1,
    );
    return this.toPage(rows, pageSize, viewerId);
  }

  /** 某用户赞过的帖子（游标键为点赞时间，而非帖子发布时间） */
  listLikedByHandle(
    handle: string,
    viewerId: number | null,
    cursor?: string,
    limit?: number,
  ): Page<PostView> {
    const profile = this.usersService.getProfileByHandle(handle);
    const { db } = this.worldManager.current();
    const pageSize = clampLimit(limit);
    const rows = postsRepo.listLikedBy(db, profile.id, decodeTsIdCursor(cursor), pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: this.buildViews(pageRows, viewerId),
      nextCursor: hasMore && last ? encodeCursor([last.liked_at, last.id]) : null,
    };
  }

  delete(postId: number, viewerId: number): void {
    const { db } = this.worldManager.current();
    const row = postsRepo.findById(db, postId);
    if (!row || row.deleted === 1) throw new NotFoundError(`帖子 #${postId} 不存在`);
    if (row.author_id !== viewerId) throw new ForbiddenError('只能删除自己的帖子');
    db.transaction(() => {
      postsRepo.markDeleted(db, postId);
      if (row.reply_to_id !== null) {
        postsRepo.adjustCounts(db, row.reply_to_id, { reply: -1 });
      }
      if (row.quote_of_id !== null) {
        postsRepo.adjustCounts(db, row.quote_of_id, { quote: -1 });
      }
      this.usersService.clearPinnedPost(row.author_id, postId);
    })();
  }

  /** 置顶到个人主页：每用户最多一条，新置顶直接替换旧的 */
  pin(viewerId: number, postId: number): { pinnedPostId: number | null } {
    const row = this.getLiveRow(postId);
    if (row.author_id !== viewerId) throw new ForbiddenError('只能置顶自己的帖子');
    this.usersService.setPinnedPost(viewerId, postId);
    return { pinnedPostId: postId };
  }

  unpin(viewerId: number, postId: number): { pinnedPostId: number | null } {
    const row = this.getLiveRow(postId);
    if (row.author_id !== viewerId) throw new ForbiddenError('只能操作自己的帖子');
    this.usersService.clearPinnedPost(viewerId, postId);
    return { pinnedPostId: null };
  }

  // ---- 以下为供本模块及 timeline/search 等模块复用的内部能力 ----

  /** 取存在且未删除的帖子原始行，否则 404（供 interactions 校验复用） */
  getLiveRow(postId: number): PostRow {
    const { db } = this.worldManager.current();
    const row = postsRepo.findById(db, postId);
    if (!row || row.deleted === 1) throw new NotFoundError(`帖子 #${postId} 不存在`);
    return row;
  }

  adjustCounts(postId: number, deltas: CountDeltas): void {
    const { db } = this.worldManager.current();
    postsRepo.adjustCounts(db, postId, deltas);
  }

  /** 批量曝光上报：每帖 +1（前端与未来的模拟器虚拟用户走同一 HTTP API） */
  recordViews(ids: number[]): void {
    const { db } = this.worldManager.current();
    postsRepo.incrementViewCounts(db, [...new Set(ids)]);
  }

  /** 按任意增量调整浏览量（预留：上帝控制台/管理端批量注入模拟浏览量） */
  addViews(postId: number, delta: number): void {
    this.adjustCounts(postId, { view: delta });
  }

  /** 按给定顺序批量构建视图（timeline 用） */
  getViewsByIds(ids: number[], viewerId: number | null): Map<number, PostView> {
    const { db } = this.worldManager.current();
    const rows = postsRepo.findByIds(db, ids);
    const views = this.buildViews(rows, viewerId);
    return new Map(views.map((v) => [v.id, v]));
  }

  /** rows → PostView[]：批量补观察者状态与一层引用嵌入 */
  buildViews(rows: PostRow[], viewerId: number | null): PostView[] {
    const { db } = this.worldManager.current();

    const quotedIds = rows
      .map((r) => r.quote_of_id)
      .filter((id): id is number => id !== null && !rows.some((r) => r.id === id));
    const quotedRows = postsRepo.findByIds(db, quotedIds);
    const allRows = [...rows, ...quotedRows];
    const allIds = allRows.map((r) => r.id);

    const liked = viewerId !== null ? postsRepo.likedSet(db, viewerId, allIds) : new Set<number>();
    const reposted =
      viewerId !== null ? postsRepo.repostedSet(db, viewerId, allIds) : new Set<number>();
    const bookmarked =
      viewerId !== null ? postsRepo.bookmarkedSet(db, viewerId, allIds) : new Set<number>();
    const followedAuthors =
      viewerId !== null
        ? postsRepo.followedAuthorSet(db, viewerId, [...new Set(allRows.map((r) => r.author_id))])
        : new Set<number>();
    const mediaMap = this.mediaService.viewsForPosts(allIds);
    // 链接卡片：取各帖正文首 URL 批量查缓存（有媒体的帖不显示卡片，X 行为）
    const firstUrls = new Map<number, string>();
    for (const r of allRows) {
      if (r.deleted === 1) continue;
      const u = extractFirstUrl(r.content);
      if (u !== null) firstUrls.set(r.id, u);
    }
    const cardMap = this.linkCardsService.viewsForUrls([...firstUrls.values()]);
    const byId = new Map(allRows.map((r) => [r.id, r]));

    const toView = (row: PostRow, embedQuote: boolean): PostView => ({
      id: row.id,
      authorId: row.author_id,
      content: row.deleted === 1 ? '' : row.content,
      replyToId: row.reply_to_id,
      quoteOfId: row.quote_of_id,
      createdAt: row.created_at,
      likeCount: row.like_count,
      repostCount: row.repost_count,
      quoteCount: row.quote_count,
      replyCount: row.reply_count,
      viewCount: row.view_count,
      deleted: row.deleted === 1,
      author: toUserSummary(
        row,
        row.author_avatar_media_id !== null
          ? this.mediaService.fileUrl(row.author_avatar_media_id)
          : null,
      ),
      likedByViewer: liked.has(row.id),
      repostedByViewer: reposted.has(row.id),
      bookmarkedByViewer: bookmarked.has(row.id),
      authorFollowedByViewer: followedAuthors.has(row.author_id),
      media: row.deleted === 1 ? [] : (mediaMap.get(row.id) ?? []),
      linkCard:
        row.deleted === 1 || (mediaMap.get(row.id)?.length ?? 0) > 0
          ? null
          : (cardMap.get(firstUrls.get(row.id) ?? '') ?? null),
      quoted:
        embedQuote && row.quote_of_id !== null
          ? (() => {
              const q = byId.get(row.quote_of_id);
              return q ? toView(q, false) : null;
            })()
          : null,
    });

    return rows.map((r) => toView(r, true));
  }

  private toPage(rows: PostRow[], pageSize: number, viewerId: number | null): Page<PostView> {
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: this.buildViews(pageRows, viewerId),
      nextCursor: hasMore && last ? encodeCursor([last.created_at, last.id]) : null,
    };
  }
}

export function toUserSummary(row: PostRow, avatarUrl: string | null): UserSummary {
  return {
    id: row.author_id,
    handle: row.author_handle,
    displayName: row.author_display_name,
    isBot: row.author_is_bot === 1,
    avatarUrl,
  };
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(limit)));
}
