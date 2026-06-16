import {
  MESSAGE_REACTION_EMOJIS,
  type ConversationDetailView,
  type ConversationView,
  type DmConversationFilter,
  type DmSearchResults,
  type DmStreamEvent,
  type DmUnreadCount,
  type MessageReactionView,
  type MessageView,
  type Page,
  type SendMessageRequest,
  type UserSummary,
  type VerifiedType,
} from '@socialsim/shared';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/app-error.js';
import { decodeCursor, decodeTsIdCursor, encodeCursor } from '../../core/pagination.js';
import type { WorldManager } from '../../core/world/world-manager.js';
import { extractFirstUrl, type LinkCardsService } from '../link-cards/link-cards.service.js';
import { mediaFileUrl, type MediaService } from '../media/media.service.js';
import {
  messagesRepo,
  type ConversationListRow,
  type MessageRow,
} from './messages.repo.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_CONTENT_LENGTH = 1000;
/** 会话列表预览截断长度 */
const PREVIEW_LENGTH = 80;
/** 私信搜索各段返回上限（不分页） */
const SEARCH_CONVERSATION_LIMIT = 10;
const SEARCH_MESSAGE_LIMIT = 20;

/** DM 实时事件发布口：B3 由 SseHub 实现；缺省 no-op（虚拟用户走纯轮询不受影响） */
export interface DmEventPublisher {
  sendToUser(worldId: string, userId: number, event: string, data: unknown): void;
}

const NOOP_PUBLISHER: DmEventPublisher = { sendToUser: () => {} };

export class MessagesService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly mediaService: MediaService,
    private readonly linkCardsService: LinkCardsService,
    private readonly publisher: DmEventPublisher = NOOP_PUBLISHER,
  ) {}

  /** 找或建 1v1 会话；dm_key 保证同一对用户唯一 */
  findOrCreateConversation(viewerId: number, targetUserId: number): ConversationDetailView {
    const { db, clock } = this.worldManager.current();
    if (targetUserId === viewerId) throw new ValidationError('不能给自己发私信');
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId) as
      | { id: number }
      | undefined;
    if (!target) throw new NotFoundError(`用户 #${targetUserId} 不存在`);
    if (messagesRepo.isBlockedEither(db, viewerId, targetUserId)) {
      throw new ForbiddenError('你与对方之间存在屏蔽关系，无法发起会话');
    }

    const dmKey = `${Math.min(viewerId, targetUserId)}:${Math.max(viewerId, targetUserId)}`;
    let conv = messagesRepo.findDmByKey(db, dmKey);
    if (!conv) {
      const now = clock.now();
      db.transaction(() => {
        const id = messagesRepo.insertConversation(db, {
          type: 'dm',
          dmKey,
          createdBy: viewerId,
          createdAt: now,
        });
        messagesRepo.insertParticipant(db, id, viewerId, now);
        messagesRepo.insertParticipant(db, id, targetUserId, now);
      })();
      conv = messagesRepo.findDmByKey(db, dmKey)!;
    }
    return this.getConversation(viewerId, conv.id);
  }

  listConversations(
    viewerId: number,
    filter: DmConversationFilter = 'inbox',
    cursor?: string,
    limit?: number,
  ): Page<ConversationView> {
    const { db, worldId } = this.worldManager.current();
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, limit ?? DEFAULT_PAGE_SIZE));
    // inbox 置顶浮顶，游标多一段置顶位；其余过滤器置顶位恒为 0
    const rows = messagesRepo.listConversations(
      db,
      viewerId,
      filter,
      parsePinnedTsIdCursor(cursor, filter === 'inbox'),
      pageSize + 1,
    );
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    const lastCursor = (row: typeof last) =>
      filter === 'inbox'
        ? encodeCursor([row!.my_pinned_at !== null ? 1 : 0, row!.last_message_at, row!.id])
        : encodeCursor([row!.last_message_at, row!.id]);
    return {
      items: pageRows.map((r) => toConversationView(r, worldId)),
      nextCursor: hasMore && last ? lastCursor(last) : null,
    };
  }

  getConversation(viewerId: number, conversationId: number): ConversationDetailView {
    const { db, worldId } = this.worldManager.current();
    const row = messagesRepo.getConversationForUser(db, conversationId, viewerId);
    if (!row) throw new NotFoundError(`会话 #${conversationId} 不存在`);
    return {
      ...toConversationView(row, worldId),
      otherLastReadMessageId: row.other_last_read_message_id,
      blockedEither: messagesRepo.isBlockedEither(db, viewerId, row.other_user_id),
    };
  }

  listMessages(
    viewerId: number,
    conversationId: number,
    cursor?: string,
    limit?: number,
  ): Page<MessageView> {
    const { db, worldId } = this.worldManager.current();
    this.requireParticipant(conversationId, viewerId);
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, limit ?? DEFAULT_PAGE_SIZE));
    const rows = messagesRepo.listMessages(db, conversationId, parseIdCursor(cursor), pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: this.buildMessageViews(pageRows, worldId),
      nextCursor: hasMore && last ? encodeCursor([last.id]) : null,
    };
  }

  async sendMessage(
    viewerId: number,
    conversationId: number,
    input: SendMessageRequest,
  ): Promise<MessageView> {
    const { db, clock, worldId } = this.worldManager.current();
    const conv = messagesRepo.findConversation(db, conversationId);
    const me = conv && messagesRepo.getParticipant(db, conversationId, viewerId);
    if (!conv || !me) throw new NotFoundError(`会话 #${conversationId} 不存在`);
    const other = messagesRepo.getOtherParticipant(db, conversationId, viewerId)!;

    if (messagesRepo.isBlockedEither(db, viewerId, other.user_id)) {
      throw new ForbiddenError('你与对方之间存在屏蔽关系，无法发送消息');
    }

    const content = input.content.trim();
    const mediaIds = input.mediaIds ?? [];
    if (content.length === 0 && mediaIds.length === 0) {
      throw new ValidationError('消息不能为空');
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new ValidationError(`消息最长 ${MAX_CONTENT_LENGTH} 字`);
    }
    this.mediaService.validateAttachableToMessage(viewerId, mediaIds);

    // 正文首个 URL 预抓 OG 卡片（内部吞错，失败不阻断发送；同发帖规则）
    const firstUrl = extractFirstUrl(content);
    if (firstUrl !== null && mediaIds.length === 0) {
      await this.linkCardsService.resolve(firstUrl, viewerId);
    }

    const now = clock.now();
    const isFirstMessage = conv.last_message_id === null;
    const messageId = db.transaction(() => {
      const id = messagesRepo.insertMessage(db, {
        conversationId,
        senderId: viewerId,
        content,
        createdAt: now,
      });
      if (mediaIds.length > 0) this.mediaService.attachToMessage(id, mediaIds);
      messagesRepo.updateConversationLastMessage(db, conversationId, id, now);
      // 请求态判定：首条消息时若接收方未关注发送方，会话进入其「消息请求」
      if (isFirstMessage && !messagesRepo.recipientFollowsSender(db, other.user_id, viewerId)) {
        messagesRepo.updateParticipantState(db, conversationId, other.user_id, 'request');
      }
      // 在请求态会话中回复 = 隐式接受（含解除隐藏）
      if (me.state === 'request') {
        messagesRepo.acceptRequest(db, conversationId, viewerId);
      }
      // 自己发的消息天然已读
      messagesRepo.updateLastRead(db, conversationId, viewerId, id);
      return id;
    })();

    const view = this.buildMessageViews([messagesRepo.findMessage(db, messageId)!], worldId)[0]!;
    this.emit(worldId, other.user_id, { type: 'message:new', conversationId, message: view });
    return view;
  }

  markRead(
    viewerId: number,
    conversationId: number,
    messageId?: number,
  ): { lastReadMessageId: number } {
    const { db, worldId } = this.worldManager.current();
    const conv = messagesRepo.findConversation(db, conversationId);
    const me = conv && messagesRepo.getParticipant(db, conversationId, viewerId);
    if (!conv || !me) throw new NotFoundError(`会话 #${conversationId} 不存在`);
    // 上限钳到会话最新消息，防止未来 id 把后续消息误判为已读
    const latest = conv.last_message_id ?? 0;
    const target = Math.min(messageId ?? latest, latest);
    const value = messagesRepo.updateLastRead(db, conversationId, viewerId, target);
    if (value > me.last_read_message_id) {
      const other = messagesRepo.getOtherParticipant(db, conversationId, viewerId)!;
      this.emit(worldId, other.user_id, {
        type: 'message:read',
        conversationId,
        userId: viewerId,
        lastReadMessageId: value,
      });
    }
    return { lastReadMessageId: value };
  }

  /** 接受消息请求（含从"隐藏"恢复被拒绝的请求）；幂等 */
  acceptRequest(viewerId: number, conversationId: number): ConversationDetailView {
    const { db } = this.worldManager.current();
    this.requireParticipant(conversationId, viewerId);
    messagesRepo.acceptRequest(db, conversationId, viewerId);
    return this.getConversation(viewerId, conversationId);
  }

  /** 拒绝请求/删除会话：只对自己隐藏，不动对方数据 */
  hideConversation(viewerId: number, conversationId: number): void {
    const { db, clock } = this.worldManager.current();
    this.requireParticipant(conversationId, viewerId);
    messagesRepo.updateHiddenAt(db, conversationId, viewerId, clock.now());
  }

  deleteMessage(viewerId: number, messageId: number): MessageView {
    const { db, worldId } = this.worldManager.current();
    const msg = this.requireVisibleMessage(messageId, viewerId);
    if (msg.sender_id !== viewerId) throw new ForbiddenError('只能删除自己的消息');
    if (msg.deleted === 0) {
      messagesRepo.softDeleteMessage(db, messageId);
      const other = messagesRepo.getOtherParticipant(db, msg.conversation_id, viewerId)!;
      this.emit(worldId, other.user_id, {
        type: 'message:deleted',
        conversationId: msg.conversation_id,
        messageId,
      });
    }
    return this.buildMessageViews([messagesRepo.findMessage(db, messageId)!], worldId)[0]!;
  }

  setReaction(viewerId: number, messageId: number, emoji: string): MessageReactionView[] {
    const { db, clock, worldId } = this.worldManager.current();
    const msg = this.requireVisibleMessage(messageId, viewerId);
    if (msg.deleted === 1) throw new ValidationError('已删除的消息不能回应');
    if (!(MESSAGE_REACTION_EMOJIS as readonly string[]).includes(emoji)) {
      throw new ValidationError('不支持的回应表情');
    }
    messagesRepo.upsertReaction(db, messageId, viewerId, emoji, clock.now());
    const other = messagesRepo.getOtherParticipant(db, msg.conversation_id, viewerId)!;
    this.emit(worldId, other.user_id, {
      type: 'message:reaction',
      conversationId: msg.conversation_id,
      messageId,
      userId: viewerId,
      emoji,
    });
    return this.reactionsOf(messageId);
  }

  removeReaction(viewerId: number, messageId: number): MessageReactionView[] {
    const { db, worldId } = this.worldManager.current();
    const msg = this.requireVisibleMessage(messageId, viewerId);
    messagesRepo.deleteReaction(db, messageId, viewerId);
    const other = messagesRepo.getOtherParticipant(db, msg.conversation_id, viewerId)!;
    this.emit(worldId, other.user_id, {
      type: 'message:reaction',
      conversationId: msg.conversation_id,
      messageId,
      userId: viewerId,
      emoji: null,
    });
    return this.reactionsOf(messageId);
  }

  unreadCount(viewerId: number): DmUnreadCount {
    const { db } = this.worldManager.current();
    return messagesRepo.unreadCounts(db, viewerId);
  }

  /** 收件箱全部标为已读（请求态会话不动，接受前不暴露已读） */
  markAllRead(viewerId: number): void {
    const { db } = this.worldManager.current();
    messagesRepo.markAllRead(db, viewerId);
  }

  /** 手动标记未读（蓝点重现；打开会话或任意已读动作清除） */
  markUnread(viewerId: number, conversationId: number): void {
    const { db } = this.worldManager.current();
    this.requireParticipant(conversationId, viewerId);
    messagesRepo.setMarkedUnread(db, conversationId, viewerId, true);
  }

  /** 静音开关：静音会话不计入导航角标 */
  setMuted(viewerId: number, conversationId: number, muted: boolean): void {
    const { db } = this.worldManager.current();
    this.requireParticipant(conversationId, viewerId);
    messagesRepo.setMuted(db, conversationId, viewerId, muted);
  }

  /** 置顶开关：收件箱列表浮顶 */
  setPinned(viewerId: number, conversationId: number, pinned: boolean): void {
    const { db, clock } = this.worldManager.current();
    this.requireParticipant(conversationId, viewerId);
    messagesRepo.setPinned(db, conversationId, viewerId, pinned ? clock.now() : null);
  }

  /** 私信搜索：按对方用户名/昵称命中会话 + 按内容命中消息（各取前若干，不分页） */
  search(viewerId: number, query: string): DmSearchResults {
    const q = query.trim();
    if (q.length === 0) throw new ValidationError('搜索关键词不能为空');
    const { db, worldId } = this.worldManager.current();
    const conversations = messagesRepo
      .searchConversations(db, viewerId, q, SEARCH_CONVERSATION_LIMIT)
      .map((r) => toConversationView(r, worldId));
    const messages = messagesRepo
      .searchMessages(db, viewerId, q, SEARCH_MESSAGE_LIMIT)
      .map((r) => ({
        conversationId: r.conversation_id,
        messageId: r.message_id,
        excerpt: r.content.slice(0, PREVIEW_LENGTH),
        senderId: r.sender_id,
        otherParticipant: {
          id: r.other_user_id,
          handle: r.other_handle,
          displayName: r.other_display_name,
          avatarUrl: mediaFileUrl(r.other_avatar_media_id, worldId),
          verified: r.other_verified as VerifiedType,
        },
        createdAt: r.created_at,
      }));
    return { conversations, messages };
  }

  /** 参与者校验；非参与者一律 404（不泄露会话存在性） */
  private requireParticipant(conversationId: number, userId: number): void {
    const { db } = this.worldManager.current();
    if (!messagesRepo.getParticipant(db, conversationId, userId)) {
      throw new NotFoundError(`会话 #${conversationId} 不存在`);
    }
  }

  /** 消息存在 + 观察者是其会话参与者；否则 404 */
  private requireVisibleMessage(messageId: number, userId: number): MessageRow {
    const { db } = this.worldManager.current();
    const msg = messagesRepo.findMessage(db, messageId);
    if (!msg || !messagesRepo.getParticipant(db, msg.conversation_id, userId)) {
      throw new NotFoundError(`消息 #${messageId} 不存在`);
    }
    return msg;
  }

  private reactionsOf(messageId: number): MessageReactionView[] {
    const { db } = this.worldManager.current();
    return messagesRepo
      .listReactionsForMessages(db, [messageId])
      .map((r) => ({ userId: r.user_id, emoji: r.emoji }));
  }

  /** 批量拼装消息视图（媒体 + 回应 + 链接卡片一次查全） */
  private buildMessageViews(rows: MessageRow[], worldId: string): MessageView[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const mediaMap = this.mediaService.viewsForMessages(ids);
    const reactionMap = new Map<number, MessageReactionView[]>();
    const { db } = this.worldManager.current();
    for (const r of messagesRepo.listReactionsForMessages(db, ids)) {
      const list = reactionMap.get(r.message_id) ?? [];
      list.push({ userId: r.user_id, emoji: r.emoji });
      reactionMap.set(r.message_id, list);
    }
    // 链接卡片：有媒体的消息不显示（同帖子规则）
    const firstUrls = new Map<number, string>();
    for (const row of rows) {
      if (row.deleted === 1) continue;
      if ((mediaMap.get(row.id)?.length ?? 0) > 0) continue;
      const url = extractFirstUrl(row.content);
      if (url !== null) firstUrls.set(row.id, url);
    }
    const cardMap = this.linkCardsService.viewsForUrls([...firstUrls.values()]);
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      sender: senderSummary(row, worldId),
      content: row.deleted === 1 ? '' : row.content,
      media: row.deleted === 1 ? [] : (mediaMap.get(row.id) ?? []),
      linkCard: cardMap.get(firstUrls.get(row.id) ?? '') ?? null,
      reactions: reactionMap.get(row.id) ?? [],
      deleted: row.deleted === 1,
      createdAt: row.created_at,
    }));
  }

  private emit(worldId: string, userId: number, event: DmStreamEvent): void {
    this.publisher.sendToUser(worldId, userId, event.type, event);
  }
}

function senderSummary(row: MessageRow, worldId: string): UserSummary {
  return {
    id: row.sender_id,
    handle: row.sender_handle,
    displayName: row.sender_display_name,
    avatarUrl: mediaFileUrl(row.sender_avatar_media_id, worldId),
    verified: row.sender_verified as VerifiedType,
  };
}

function toConversationView(row: ConversationListRow, worldId: string): ConversationView {
  return {
    id: row.id,
    type: 'dm',
    otherParticipant: {
      id: row.other_user_id,
      handle: row.other_handle,
      displayName: row.other_display_name,
      avatarUrl: mediaFileUrl(row.other_avatar_media_id, worldId),
      verified: row.other_verified as VerifiedType,
    },
    state: row.my_state,
    markedUnread: row.my_marked_unread === 1,
    muted: row.my_muted === 1,
    pinned: row.my_pinned_at !== null,
    lastMessage:
      row.last_message_id !== null && row.last_msg_created_at !== null
        ? {
            id: row.last_message_id,
            senderId: row.last_msg_sender_id!,
            content:
              row.last_msg_deleted === 1 ? '' : (row.last_msg_content ?? '').slice(0, PREVIEW_LENGTH),
            hasMedia: row.last_msg_deleted !== 1 && row.last_msg_has_media === 1,
            deleted: row.last_msg_deleted === 1,
            createdAt: row.last_msg_created_at,
          }
        : null,
    unreadCount: row.unread_count,
    createdAt: row.created_at,
  };
}

function parseIdCursor(cursor: string | undefined): number | null {
  const parts = decodeCursor(cursor);
  return parts && parts.length === 1 && typeof parts[0] === 'number' ? parts[0] : null;
}

/** 会话列表游标：inbox 为 [置顶位, 时间, id] 三段，其余为 [时间, id] 双段（置顶位补 0） */
function parsePinnedTsIdCursor(
  cursor: string | undefined,
  withPin: boolean,
): { pinned: number; ts: number; id: number } | null {
  if (withPin) {
    const parts = decodeCursor(cursor);
    return parts &&
      parts.length === 3 &&
      typeof parts[0] === 'number' &&
      typeof parts[1] === 'number' &&
      typeof parts[2] === 'number'
      ? { pinned: parts[0], ts: parts[1], id: parts[2] }
      : null;
  }
  const tsId = decodeTsIdCursor(cursor);
  return tsId ? { pinned: 0, ...tsId } : null;
}
