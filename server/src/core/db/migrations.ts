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
  {
    version: 3,
    name: 'bookmarks',
    sql: `
      CREATE TABLE bookmarks (
        user_id    INTEGER NOT NULL REFERENCES users(id),
        post_id    INTEGER NOT NULL REFERENCES posts(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, post_id)
      );
      CREATE INDEX idx_bookmarks_user_time ON bookmarks(user_id, created_at DESC);
    `,
  },
  {
    version: 4,
    name: 'posts-quote-count',
    sql: `
      ALTER TABLE posts ADD COLUMN quote_count INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_posts_quote_of ON posts(quote_of_id);
      UPDATE posts SET quote_count = (
        SELECT COUNT(*) FROM posts p2
        WHERE p2.quote_of_id = posts.id AND p2.deleted = 0
      );
    `,
  },
  {
    version: 5,
    name: 'posts-view-count',
    sql: `
      ALTER TABLE posts ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 6,
    name: 'blocks-hidden-pin',
    sql: `
      CREATE TABLE blocks (
        blocker_id INTEGER NOT NULL REFERENCES users(id),
        blocked_id INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (blocker_id, blocked_id)
      );

      CREATE TABLE hidden_posts (
        user_id    INTEGER NOT NULL REFERENCES users(id),
        post_id    INTEGER NOT NULL REFERENCES posts(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, post_id)
      );

      ALTER TABLE users ADD COLUMN pinned_post_id INTEGER REFERENCES posts(id);
    `,
  },
  {
    version: 7,
    name: 'media',
    sql: `
      CREATE TABLE media (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id    INTEGER NOT NULL REFERENCES users(id),
        type        TEXT    NOT NULL,
        file_name   TEXT    NOT NULL,
        mime        TEXT    NOT NULL,
        width       INTEGER,
        height      INTEGER,
        size_bytes  INTEGER NOT NULL,
        source      TEXT    NOT NULL DEFAULT 'upload',
        origin_url  TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_media_owner ON media(owner_id, created_at DESC);

      CREATE TABLE post_media (
        post_id  INTEGER NOT NULL REFERENCES posts(id),
        media_id INTEGER NOT NULL REFERENCES media(id),
        position INTEGER NOT NULL,
        PRIMARY KEY (post_id, position)
      );
      CREATE INDEX idx_post_media_media ON post_media(media_id);
      CREATE INDEX idx_post_media_post  ON post_media(post_id);

      ALTER TABLE users ADD COLUMN avatar_media_id INTEGER REFERENCES media(id);
      ALTER TABLE users ADD COLUMN banner_media_id INTEGER REFERENCES media(id);
    `,
  },
  {
    version: 8,
    name: 'link-cards',
    sql: `
      CREATE TABLE link_cards (
        url            TEXT PRIMARY KEY,
        title          TEXT,
        description    TEXT,
        image_media_id INTEGER REFERENCES media(id),
        site_name      TEXT,
        status         TEXT NOT NULL DEFAULT 'ok',
        fetched_at     INTEGER NOT NULL
      );
    `,
  },
  {
    version: 9,
    name: 'user-verified-website',
    sql: `
      ALTER TABLE users ADD COLUMN verified TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE users ADD COLUMN website TEXT;
    `,
  },
  {
    version: 10,
    name: 'user-profile-extras',
    sql: `
      ALTER TABLE users ADD COLUMN location TEXT;
      ALTER TABLE users ADD COLUMN birth_date TEXT;
      ALTER TABLE users ADD COLUMN profession TEXT;
      ALTER TABLE users ADD COLUMN verified_at INTEGER;
    `,
  },
  {
    version: 11,
    name: 'direct-messages',
    sql: `
      CREATE TABLE conversations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        type            TEXT    NOT NULL DEFAULT 'dm',
        dm_key          TEXT    UNIQUE,
        created_by      INTEGER NOT NULL REFERENCES users(id),
        created_at      INTEGER NOT NULL,
        last_message_id INTEGER,
        last_message_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_conversations_last ON conversations(last_message_at DESC);

      CREATE TABLE conversation_participants (
        conversation_id      INTEGER NOT NULL REFERENCES conversations(id),
        user_id              INTEGER NOT NULL REFERENCES users(id),
        state                TEXT    NOT NULL DEFAULT 'inbox',
        last_read_message_id INTEGER NOT NULL DEFAULT 0,
        hidden_at            INTEGER,
        joined_at            INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, user_id)
      );
      CREATE INDEX idx_participants_user ON conversation_participants(user_id, state);

      CREATE TABLE messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        sender_id       INTEGER NOT NULL REFERENCES users(id),
        content         TEXT    NOT NULL DEFAULT '',
        created_at      INTEGER NOT NULL,
        deleted         INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_messages_conv ON messages(conversation_id, id DESC);

      CREATE TABLE message_media (
        message_id INTEGER NOT NULL REFERENCES messages(id),
        media_id   INTEGER NOT NULL REFERENCES media(id),
        position   INTEGER NOT NULL,
        PRIMARY KEY (message_id, position)
      );
      CREATE INDEX idx_message_media_media ON message_media(media_id);

      CREATE TABLE message_reactions (
        message_id INTEGER NOT NULL REFERENCES messages(id),
        user_id    INTEGER NOT NULL REFERENCES users(id),
        emoji      TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, user_id)
      );
      CREATE INDEX idx_message_reactions_msg ON message_reactions(message_id);
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
