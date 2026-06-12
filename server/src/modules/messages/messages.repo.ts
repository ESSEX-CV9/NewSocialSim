import type { ConversationState, DmConversationFilter } from '@socialsim/shared';
import type { WorldDb } from '../../core/db/database.js';

/** LIKE 通配符转义：让用户输入的 % _ 按字面匹配 */
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** conversations 表原始行 */
export interface ConversationRow {
  id: number;
  type: string;
  dm_key: string | null;
  created_by: number;
  created_at: number;
  last_message_id: number | null;
  last_message_at: number;
}

/** conversation_participants 表原始行 */
export interface ParticipantRow {
  conversation_id: number;
  user_id: number;
  state: ConversationState;
  last_read_message_id: number;
  hidden_at: number | null;
  joined_at: number;
}

/** 会话列表/详情行：会话 + 观察者参与态 + 对方用户摘要 + 最后消息预览 + 未读数 */
export interface ConversationListRow extends ConversationRow {
  my_state: ConversationState;
  my_last_read_message_id: number;
  other_user_id: number;
  other_handle: string;
  other_display_name: string;
  other_is_bot: number;
  other_avatar_media_id: number | null;
  other_verified: string;
  other_last_read_message_id: number;
  unread_count: number;
  last_msg_sender_id: number | null;
  last_msg_content: string | null;
  last_msg_deleted: number | null;
  last_msg_created_at: number | null;
  last_msg_has_media: number | null;
}

/** messages 表行 + 发送者用户摘要 */
export interface MessageRow {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  created_at: number;
  deleted: number;
  sender_handle: string;
  sender_display_name: string;
  sender_is_bot: number;
  sender_avatar_media_id: number | null;
  sender_verified: string;
}

export interface ReactionRow {
  message_id: number;
  user_id: number;
  emoji: string;
}

/** 私信消息搜索命中行：消息 + 所属会话的对方用户摘要 */
export interface MessageSearchRow {
  message_id: number;
  conversation_id: number;
  content: string;
  sender_id: number;
  created_at: number;
  other_user_id: number;
  other_handle: string;
  other_display_name: string;
  other_is_bot: number;
  other_avatar_media_id: number | null;
  other_verified: string;
}

/** 隐藏的会话不出现在列表与未读统计；对方再发消息（last_message_at 推进）后自然重现 */
const NOT_HIDDEN = 'AND (cp.hidden_at IS NULL OR c.last_message_at > cp.hidden_at)';

/** 观察者视角的未读消息数（不计自己发的与墓碑） */
const UNREAD_COUNT_SQL = `(
  SELECT COUNT(*) FROM messages m
  WHERE m.conversation_id = c.id
    AND m.id > cp.last_read_message_id
    AND m.sender_id != cp.user_id
    AND m.deleted = 0
)`;

/** 会话查询共用的 SELECT 主体（cp = 观察者参与行，op/u = 对方） */
const CONVERSATION_SELECT = `
  SELECT c.*,
         cp.state                 AS my_state,
         cp.last_read_message_id  AS my_last_read_message_id,
         u.id                     AS other_user_id,
         u.handle                 AS other_handle,
         u.display_name           AS other_display_name,
         u.is_bot                 AS other_is_bot,
         u.avatar_media_id        AS other_avatar_media_id,
         u.verified               AS other_verified,
         op.last_read_message_id  AS other_last_read_message_id,
         ${UNREAD_COUNT_SQL}      AS unread_count,
         lm.sender_id             AS last_msg_sender_id,
         lm.content               AS last_msg_content,
         lm.deleted               AS last_msg_deleted,
         lm.created_at            AS last_msg_created_at,
         (SELECT EXISTS(SELECT 1 FROM message_media mm WHERE mm.message_id = lm.id)) AS last_msg_has_media
  FROM conversations c
  JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = @userId
  JOIN conversation_participants op ON op.conversation_id = c.id AND op.user_id != @userId
  JOIN users u ON u.id = op.user_id
  LEFT JOIN messages lm ON lm.id = c.last_message_id
  WHERE c.type = 'dm'
`;

export const messagesRepo = {
  /** 双向任一方向存在屏蔽即真 */
  isBlockedEither(db: WorldDb, a: number, b: number): boolean {
    const row = db
      .prepare(
        `SELECT EXISTS(
           SELECT 1 FROM blocks
           WHERE (blocker_id = @a AND blocked_id = @b) OR (blocker_id = @b AND blocked_id = @a)
         ) AS x`,
      )
      .get({ a, b }) as { x: number };
    return row.x === 1;
  },

  recipientFollowsSender(db: WorldDb, recipientId: number, senderId: number): boolean {
    const row = db
      .prepare(
        'SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS x',
      )
      .get(recipientId, senderId) as { x: number };
    return row.x === 1;
  },

  findDmByKey(db: WorldDb, dmKey: string): ConversationRow | undefined {
    return db.prepare('SELECT * FROM conversations WHERE dm_key = ?').get(dmKey) as
      | ConversationRow
      | undefined;
  },

  findConversation(db: WorldDb, id: number): ConversationRow | undefined {
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | ConversationRow
      | undefined;
  },

  insertConversation(
    db: WorldDb,
    input: { type: 'dm'; dmKey: string; createdBy: number; createdAt: number },
  ): number {
    const result = db
      .prepare(
        `INSERT INTO conversations (type, dm_key, created_by, created_at, last_message_at)
         VALUES (?, ?, ?, ?, 0)`,
      )
      .run(input.type, input.dmKey, input.createdBy, input.createdAt);
    return Number(result.lastInsertRowid);
  },

  insertParticipant(db: WorldDb, conversationId: number, userId: number, joinedAt: number): void {
    db.prepare(
      `INSERT INTO conversation_participants (conversation_id, user_id, joined_at)
       VALUES (?, ?, ?)`,
    ).run(conversationId, userId, joinedAt);
  },

  getParticipant(db: WorldDb, conversationId: number, userId: number): ParticipantRow | undefined {
    return db
      .prepare(
        'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      )
      .get(conversationId, userId) as ParticipantRow | undefined;
  },

  /** 1v1 会话中的对方参与行 */
  getOtherParticipant(
    db: WorldDb,
    conversationId: number,
    userId: number,
  ): ParticipantRow | undefined {
    return db
      .prepare(
        'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id != ?',
      )
      .get(conversationId, userId) as ParticipantRow | undefined;
  },

  /** 观察者视角的会话详情行；非参与者返回 undefined */
  getConversationForUser(
    db: WorldDb,
    conversationId: number,
    userId: number,
  ): ConversationListRow | undefined {
    return db
      .prepare(`${CONVERSATION_SELECT} AND c.id = @conversationId`)
      .get({ userId, conversationId }) as ConversationListRow | undefined;
  },

  /** 会话列表：只列有消息的会话，按最后消息时间倒序，双段游标 */
  listConversations(
    db: WorldDb,
    userId: number,
    filter: DmConversationFilter,
    cursor: { ts: number; id: number } | null,
    limit: number,
  ): ConversationListRow[] {
    // hidden = 已拒绝的请求（state 仍为 request 且被自己隐藏），其余过滤器都排除隐藏会话
    const filterClause = {
      inbox: `AND cp.state = 'inbox' ${NOT_HIDDEN}`,
      unread: `AND cp.state = 'inbox' ${NOT_HIDDEN} AND ${UNREAD_COUNT_SQL} > 0`,
      requests: `AND cp.state = 'request' ${NOT_HIDDEN}`,
      hidden: `AND cp.state = 'request' AND cp.hidden_at IS NOT NULL AND c.last_message_at <= cp.hidden_at`,
    }[filter];
    const cursorClause =
      cursor !== null
        ? 'AND (c.last_message_at < @cursorTs OR (c.last_message_at = @cursorTs AND c.id < @cursorId))'
        : '';
    return db
      .prepare(
        `${CONVERSATION_SELECT}
           AND c.last_message_id IS NOT NULL
           ${filterClause} ${cursorClause}
         ORDER BY c.last_message_at DESC, c.id DESC
         LIMIT @limit`,
      )
      .all({
        userId,
        limit,
        ...(cursor !== null ? { cursorTs: cursor.ts, cursorId: cursor.id } : {}),
      }) as ConversationListRow[];
  },

  /** 收件箱全部标为已读：各会话的已读位置推进到其最新消息（只增不减） */
  markAllRead(db: WorldDb, userId: number): void {
    db.prepare(
      `UPDATE conversation_participants
       SET last_read_message_id = MAX(
         last_read_message_id,
         COALESCE((SELECT c.last_message_id FROM conversations c WHERE c.id = conversation_id), 0)
       )
       WHERE user_id = @userId AND state = 'inbox'`,
    ).run({ userId });
  },

  /** 按对方用户名/昵称搜自己的会话（含请求态，排除隐藏） */
  searchConversations(db: WorldDb, userId: number, query: string, limit: number): ConversationListRow[] {
    return db
      .prepare(
        `${CONVERSATION_SELECT}
           AND c.last_message_id IS NOT NULL ${NOT_HIDDEN}
           AND (u.handle LIKE @pattern ESCAPE '\\' OR u.display_name LIKE @pattern ESCAPE '\\')
         ORDER BY c.last_message_at DESC, c.id DESC
         LIMIT @limit`,
      )
      .all({ userId, pattern: `%${escapeLike(query)}%`, limit }) as ConversationListRow[];
  },

  /** 按内容搜自己全部会话里的消息（排除墓碑与隐藏会话），新消息在前 */
  searchMessages(db: WorldDb, userId: number, query: string, limit: number): MessageSearchRow[] {
    return db
      .prepare(
        `SELECT m.id AS message_id, m.conversation_id, m.content, m.sender_id, m.created_at,
                u.id              AS other_user_id,
                u.handle          AS other_handle,
                u.display_name    AS other_display_name,
                u.is_bot          AS other_is_bot,
                u.avatar_media_id AS other_avatar_media_id,
                u.verified        AS other_verified
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = @userId
         JOIN conversation_participants op ON op.conversation_id = m.conversation_id AND op.user_id != @userId
         JOIN users u ON u.id = op.user_id
         WHERE m.deleted = 0 AND m.content LIKE @pattern ESCAPE '\\' ${NOT_HIDDEN}
         ORDER BY m.id DESC
         LIMIT @limit`,
      )
      .all({ userId, pattern: `%${escapeLike(query)}%`, limit }) as MessageSearchRow[];
  },

  /** 导航角标：主收件箱含未读的会话数 + 待处理请求会话数 */
  unreadCounts(db: WorldDb, userId: number): { count: number; requestCount: number } {
    const row = db
      .prepare(
        `SELECT
           COUNT(CASE WHEN cp.state = 'inbox' AND ${UNREAD_COUNT_SQL} > 0 THEN 1 END) AS inbox_unread,
           COUNT(CASE WHEN cp.state = 'request' THEN 1 END) AS request_count
         FROM conversations c
         JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = @userId
         WHERE c.type = 'dm' AND c.last_message_id IS NOT NULL ${NOT_HIDDEN}`,
      )
      .get({ userId }) as { inbox_unread: number; request_count: number };
    return { count: row.inbox_unread, requestCount: row.request_count };
  },

  /** 消息列表：id 倒序（最新在前），游标为 beforeId */
  listMessages(
    db: WorldDb,
    conversationId: number,
    beforeId: number | null,
    limit: number,
  ): MessageRow[] {
    const cursorClause = beforeId !== null ? 'AND m.id < @beforeId' : '';
    return db
      .prepare(
        `SELECT m.*,
                u.handle          AS sender_handle,
                u.display_name    AS sender_display_name,
                u.is_bot          AS sender_is_bot,
                u.avatar_media_id AS sender_avatar_media_id,
                u.verified        AS sender_verified
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = @conversationId ${cursorClause}
         ORDER BY m.id DESC
         LIMIT @limit`,
      )
      .all({
        conversationId,
        limit,
        ...(beforeId !== null ? { beforeId } : {}),
      }) as MessageRow[];
  },

  findMessage(db: WorldDb, id: number): MessageRow | undefined {
    return db
      .prepare(
        `SELECT m.*,
                u.handle          AS sender_handle,
                u.display_name    AS sender_display_name,
                u.is_bot          AS sender_is_bot,
                u.avatar_media_id AS sender_avatar_media_id,
                u.verified        AS sender_verified
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.id = ?`,
      )
      .get(id) as MessageRow | undefined;
  },

  insertMessage(
    db: WorldDb,
    input: { conversationId: number; senderId: number; content: string; createdAt: number },
  ): number {
    const result = db
      .prepare(
        `INSERT INTO messages (conversation_id, sender_id, content, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.conversationId, input.senderId, input.content, input.createdAt);
    return Number(result.lastInsertRowid);
  },

  updateConversationLastMessage(
    db: WorldDb,
    conversationId: number,
    messageId: number,
    at: number,
  ): void {
    db.prepare('UPDATE conversations SET last_message_id = ?, last_message_at = ? WHERE id = ?').run(
      messageId,
      at,
      conversationId,
    );
  },

  updateParticipantState(
    db: WorldDb,
    conversationId: number,
    userId: number,
    state: ConversationState,
  ): void {
    db.prepare(
      'UPDATE conversation_participants SET state = ? WHERE conversation_id = ? AND user_id = ?',
    ).run(state, conversationId, userId);
  },

  /** 接受请求（显式或回复隐式）：转入收件箱并解除隐藏（拒绝过的请求可从"隐藏"里恢复） */
  acceptRequest(db: WorldDb, conversationId: number, userId: number): void {
    db.prepare(
      `UPDATE conversation_participants SET state = 'inbox', hidden_at = NULL
       WHERE conversation_id = ? AND user_id = ?`,
    ).run(conversationId, userId);
  },

  /** 已读位置只增不减（幂等、防乱序请求回退） */
  updateLastRead(db: WorldDb, conversationId: number, userId: number, messageId: number): number {
    db.prepare(
      `UPDATE conversation_participants
       SET last_read_message_id = MAX(last_read_message_id, @messageId)
       WHERE conversation_id = @conversationId AND user_id = @userId`,
    ).run({ conversationId, userId, messageId });
    const row = db
      .prepare(
        'SELECT last_read_message_id AS v FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      )
      .get(conversationId, userId) as { v: number };
    return row.v;
  },

  updateHiddenAt(db: WorldDb, conversationId: number, userId: number, hiddenAt: number): void {
    db.prepare(
      'UPDATE conversation_participants SET hidden_at = ? WHERE conversation_id = ? AND user_id = ?',
    ).run(hiddenAt, conversationId, userId);
  },

  /** 软删除：内容清空、标记 deleted；message_media 关联保留（墓碑仍占用媒体） */
  softDeleteMessage(db: WorldDb, messageId: number): void {
    db.prepare("UPDATE messages SET deleted = 1, content = '' WHERE id = ?").run(messageId);
  },

  /** 每人每消息一个回应；换 emoji 覆盖（X 行为），幂等 */
  upsertReaction(
    db: WorldDb,
    messageId: number,
    userId: number,
    emoji: string,
    createdAt: number,
  ): void {
    db.prepare(
      `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
    ).run(messageId, userId, emoji, createdAt);
  },

  deleteReaction(db: WorldDb, messageId: number, userId: number): void {
    db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(
      messageId,
      userId,
    );
  },

  listReactionsForMessages(db: WorldDb, messageIds: number[]): ReactionRow[] {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT message_id, user_id, emoji FROM message_reactions
         WHERE message_id IN (${placeholders})
         ORDER BY created_at, user_id`,
      )
      .all(...messageIds) as ReactionRow[];
  },
};
