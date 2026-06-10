import type { WorldDb } from '../../core/db/database.js';

/** auth 模块只关心凭据相关的读写；用户资料查询归 users 模块 */
export const authRepo = {
  insertUser(
    db: WorldDb,
    input: { handle: string; displayName: string; passwordHash: string; createdAt: number },
  ): number {
    const result = db
      .prepare(
        'INSERT INTO users (handle, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(input.handle, input.displayName, input.passwordHash, input.createdAt);
    return Number(result.lastInsertRowid);
  },

  findCredentials(
    db: WorldDb,
    handle: string,
  ): { id: number; handle: string; password_hash: string } | undefined {
    return db
      .prepare('SELECT id, handle, password_hash FROM users WHERE handle = ?')
      .get(handle) as { id: number; handle: string; password_hash: string } | undefined;
  },

  handleExists(db: WorldDb, handle: string): boolean {
    return db.prepare('SELECT 1 FROM users WHERE handle = ?').get(handle) !== undefined;
  },
};
