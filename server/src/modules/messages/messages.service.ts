import {
  MESSAGE_REACTION_EMOJIS,
  type ConversationDetailView,
  type ConversationView,
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

/** DM 实时事件发布口：B3 由 SseHub 实现；缺省 no-op（虚拟用户走纯轮询不受影响） */
export interface DmEventPublisher {
  sendToUser(worldId: string, userId: number, event: string, data: unknown): void;
}

const NOOP_PUBLISHER: DmEventPublisher = { sendToUser: () => {} };

export class MessagesService {
  constructor(
    private readonly worldManager: WorldManager,
    private readonly mediaService: MediaService,
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
    filter: 'inbox' | 'requests' = 'inbox',
    cursor?: string,
    limit?: number,
  ): Page<ConversationView> {
    const { db, worldId } = this.worldManager.current();
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, limit ?? DEFAULT_PAGE_SIZE));
    const rows = messagesRepo.listConversations(
      db,
      viewerId,
      filter,
      decodeTsIdCursor(cursor),
      pageSize + 1,
    );
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map((r) => toConversationView(r, worldId)),
      nextCursor: hasMore && last ? encodeCursor([last.last_message_at, last.id]) : null,
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

  sendMessage(viewerId: number, conversationId: number, input: SendMessageRequest): MessageView {
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
      // 在请求态会话中回复 = 隐式接受
      if (me.state === 'request') {
        messagesRepo.updateParticipantState(db, conversationId, viewerId, 'inbox');
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

  /** 接受消息请求；幂等 */
  acceptRequest(viewerId: number, conversationId: number): ConversationDetailView {
    const { db } = this.worldManager.current();
    this.requireParticipant(conversationId, viewerId);
    messagesRepo.updateParticipantState(db, conversationId, viewerId, 'inbox');
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

  /** 批量拼装消息视图（媒体 + 回应一次查全） */
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
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      sender: senderSummary(row, worldId),
      content: row.deleted === 1 ? '' : row.content,
      media: row.deleted === 1 ? [] : (mediaMap.get(row.id) ?? []),
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
    isBot: row.sender_is_bot === 1,
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
      isBot: row.other_is_bot === 1,
      avatarUrl: mediaFileUrl(row.other_avatar_media_id, worldId),
      verified: row.other_verified as VerifiedType,
    },
    state: row.my_state,
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
