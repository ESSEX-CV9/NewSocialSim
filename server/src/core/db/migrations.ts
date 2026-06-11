import type { WorldDb } from './database.js';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * 版本化 migration：以 PRAGMA user_version 记录已应用到的版本，
 * 新世界从 0 跑到最新；旧世界增量应用。只增不改——已发布的条目不要再编辑。
 */
const migrations: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        handle        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT    NOT NULL,
        bio           TEXT    NOT NULL DEFAULT '',
        password_hash TEXT    NOT NULL,
        is_bot        INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE posts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id    INTEGER NOT NULL REFERENCES users(id),
        content      TEXT    NOT NULL,
        reply_to_id  INTEGER REFERENCES posts(id),
        quote_of_id  INTEGER REFERENCES posts(id),
        created_at   INTEGER NOT NULL,
        like_count   INTEGER NOT NULL DEFAULT 0,
        repost_count INTEGER NOT NULL DEFAULT 0,
        reply_count  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_posts_author   ON posts(author_id, created_at DESC);
      CREATE INDEX idx_posts_created  ON posts(created_at DESC);
      CREATE INDEX idx_posts_reply_to ON posts(reply_to_id);

      CREATE TABLE likes (
        user_id    INTEGER NOT NULL REFERENCES users(id),
        post_id    INTEGER NOT NULL REFERENCES posts(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, post_id)
      );
      CREATE INDEX idx_likes_post ON likes(post_id);

      CREATE TABLE reposts (
        user_id    INTEGER NOT NULL REFERENCES users(id),
        post_id    INTEGER NOT NULL REFERENCES posts(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, post_id)
      );
      CREATE INDEX idx_reposts_post ON reposts(post_id);

      CREATE TABLE follows (
        follower_id INTEGER NOT NULL REFERENCES users(id),
        followee_id INTEGER NOT NULL REFERENCES users(id),
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (follower_id, followee_id)
      );
      CREATE INDEX idx_follows_followee ON follows(followee_id);

      CREATE TABLE notifications (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        type       TEXT    NOT NULL,
        actor_id   INTEGER NOT NULL REFERENCES users(id),
        post_id    INTEGER REFERENCES posts(id),
        read       INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
    `,
  },
  {
    version: 2,
    name: 'posts-soft-delete',
    sql: `
      ALTER TABLE posts ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

export function migrate(db: WorldDb): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}
