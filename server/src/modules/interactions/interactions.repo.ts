import type { WorldDb } from '../../core/db/database.js';

type InteractionTable = 'likes' | 'reposts';

/** 点赞/转发共用同一套"用户-帖子"二元关系操作 */
export const interactionsRepo = {
  /** 幂等插入；返回是否真的新增了 */
  insert(
    db: WorldDb,
    table: InteractionTable,
    userId: number,
    postId: number,
    createdAt: number,
  ): boolean {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO ${table} (user_id, post_id, created_at) VALUES (?, ?, ?)`,
      )
      .run(userId, postId, createdAt);
    return result.changes > 0;
  },

  /** 幂等删除；返回是否真的删除了 */
  remove(db: WorldDb, table: InteractionTable, userId: number, postId: number): boolean {
    const result = db
      .prepare(`DELETE FROM ${table} WHERE user_id = ? AND post_id = ?`)
      .run(userId, postId);
    return result.changes > 0;
  },
};
