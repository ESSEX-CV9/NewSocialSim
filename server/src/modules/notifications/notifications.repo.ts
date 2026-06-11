import type { NotificationType } from '@socialsim/shared';
import type { WorldDb } from '../../core/db/database.js';

export interface NotificationRow {
  id: number;
  user_id: number;
  type: NotificationType;
  actor_id: number;
  post_id: number | null;
  read: number;
  created_at: number;
  actor_handle: string;
  actor_display_name: string;
  actor_is_bot: number;
  actor_follower_count: number;
  actor_followed: number;
  post_content: string | null;
  post_deleted: number | null;
}

export const notificationsRepo = {
  insert(
    db: WorldDb,
    input: {
      userId: number;
      type: NotificationType;
      actorId: number;
      postId: number | null;
      createdAt: number;
    },
  ): void {
    db.prepare(
      `INSERT INTO notifications (user_id, type, actor_id, post_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(input.userId, input.type, input.actorId, input.postId, input.createdAt);
  },

  list(
    db: WorldDb,
    userId: number,
    mentionsOnly: boolean,
    beforeId: number | null,
    limit: number,
  ): NotificationRow[] {
    const cursorClause = beforeId !== null ? 'AND n.id < @beforeId' : '';
    // “提及”= 指向你的帖子：@mention 与回复
    const filterClause = mentionsOnly ? "AND n.type IN ('mention', 'reply')" : '';
    return db
      .prepare(
        `SELECT n.*,
                u.handle       AS actor_handle,
                u.display_name AS actor_display_name,
                u.is_bot       AS actor_is_bot,
                (SELECT COUNT(*) FROM follows WHERE followee_id = n.actor_id) AS actor_follower_count,
                EXISTS(
                  SELECT 1 FROM follows WHERE follower_id = @userId AND followee_id = n.actor_id
                ) AS actor_followed,
                p.content      AS post_content,
                p.deleted      AS post_deleted
         FROM notifications n
         JOIN users u ON u.id = n.actor_id
         LEFT JOIN posts p ON p.id = n.post_id
         WHERE n.user_id = @userId ${filterClause} ${cursorClause}
         ORDER BY n.id DESC
         LIMIT @limit`,
      )
      .all({ userId, limit, ...(beforeId !== null ? { beforeId } : {}) }) as NotificationRow[];
  },

  unreadCount(db: WorldDb, userId: number): number {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0')
      .get(userId) as { c: number };
    return row.c;
  },

  markAllRead(db: WorldDb, userId: number): void {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
  },
};
