import type { MediaView, UserSummary } from './views.js';

/** 会话在观察者收件箱中的位置：主收件箱 / 消息请求（对方未关注你时的来信） */
export type ConversationState = 'inbox' | 'request';

/** 消息表情回应的 emoji 白名单（服务端校验、前端选择器共用） */
export const MESSAGE_REACTION_EMOJIS = ['❤️', '👍', '👎', '😂', '😢', '🔥', '😲'] as const;
export type MessageReactionEmoji = (typeof MESSAGE_REACTION_EMOJIS)[number];

export interface MessageReactionView {
  userId: number;
  emoji: string;
}

/** 面向展示的私信消息 */
export interface MessageView {
  id: number;
  conversationId: number;
  sender: UserSummary;
  /** 墓碑（已删除）时为 '' */
  content: string;
  /** 按 position 排序，最多 4 个；墓碑时为空数组 */
  media: MediaView[];
  reactions: MessageReactionView[];
  deleted: boolean;
  createdAt: number;
}

/** 会话列表预览用的最后一条消息摘要 */
export interface LastMessagePreview {
  id: number;
  senderId: number;
  content: string;
  hasMedia: boolean;
  deleted: boolean;
  createdAt: number;
}

/** 面向展示的会话（观察者视角） */
export interface ConversationView {
  id: number;
  /** v1 仅 'dm'；schema 已为群聊预留 */
  type: 'dm';
  /** 1v1 会话的对方 */
  otherParticipant: UserSummary;
  /** 观察者自己的收件箱位置 */
  state: ConversationState;
  lastMessage: LastMessagePreview | null;
  /** 观察者未读消息数 */
  unreadCount: number;
  createdAt: number;
}

/** 会话详情：列表视图 + 已读回执与屏蔽状态 */
export interface ConversationDetailView extends ConversationView {
  /** 对方已读到的消息 id（0 = 一条未读）；驱动"已读"回执 */
  otherLastReadMessageId: number;
  /** 双方任一方向存在屏蔽（前端禁用输入框） */
  blockedEither: boolean;
}

export interface CreateConversationRequest {
  userId: number;
}

export interface SendMessageRequest {
  content: string;
  /** 最多 4 个，可与文本同发；有媒体时 content 可为空 */
  mediaIds?: number[];
}

export interface DmUnreadCount {
  /** 主收件箱中含未读消息的会话数 */
  count: number;
  /** 待处理的消息请求会话数 */
  requestCount: number;
}

/**
 * 会话列表过滤器：inbox 收件箱全部 / unread 收件箱未读 /
 * requests 待处理请求 / hidden 已拒绝（隐藏）的请求（对方再发消息会回到 requests）
 */
export type DmConversationFilter = 'inbox' | 'unread' | 'requests' | 'hidden';

/** 私信搜索：命中消息（点击跳转所属会话） */
export interface DmMessageMatch {
  conversationId: number;
  messageId: number;
  /** 命中消息的内容截断 */
  excerpt: string;
  senderId: number;
  otherParticipant: UserSummary;
  createdAt: number;
}

/** 私信搜索结果：按对方用户名/昵称命中的会话 + 按内容命中的消息 */
export interface DmSearchResults {
  conversations: ConversationView[];
  messages: DmMessageMatch[];
}

/** SSE 推送事件（data 为 JSON；event 字段即 type） */
export type DmStreamEvent =
  | { type: 'message:new'; conversationId: number; message: MessageView }
  | { type: 'message:read'; conversationId: number; userId: number; lastReadMessageId: number }
  | {
      type: 'message:reaction';
      conversationId: number;
      messageId: number;
      userId: number;
      /** null = 撤销回应 */
      emoji: string | null;
    }
  | { type: 'message:deleted'; conversationId: number; messageId: number };
