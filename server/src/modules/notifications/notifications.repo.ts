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

  list(db: WorldDb, userId: number, beforeId: number | null, limit: number): NotificationRow[] {
    const cursorClause = beforeId !== null ? 'AND n.id < @beforeId' : '';
    return db
      .prepare(
        `SELECT n.*,
                u.handle       AS actor_handle,
                u.display_name AS actor_display_name,
                u.is_bot       AS actor_is_bot
         FROM notifications n
         JOIN users u ON u.id = n.actor_id
         WHERE n.user_id = @userId ${cursorClause}
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
