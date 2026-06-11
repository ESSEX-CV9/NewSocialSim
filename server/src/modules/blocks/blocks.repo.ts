import type { WorldDb } from '../../core/db/database.js';

export const blocksRepo = {
  insert(db: WorldDb, blockerId: number, blockedId: number, createdAt: number): boolean {
    const result = db
      .prepare(
        'INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
      )
      .run(blockerId, blockedId, createdAt);
    return result.changes > 0;
  },

  remove(db: WorldDb, blockerId: number, blockedId: number): boolean {
    const result = db
      .prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
      .run(blockerId, blockedId);
    return result.changes > 0;
  },
};
