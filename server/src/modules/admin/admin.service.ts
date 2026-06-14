import fs from 'node:fs';
import path from 'node:path';
import type { WorldManager } from '../../core/world/world-manager.js';
import type { WorldDb } from '../../core/db/database.js';
import { ValidationError, NotFoundError } from '../../core/errors/app-error.js';
import { postsRepo } from '../posts/posts.repo.js';
import { followsRepo } from '../follows/follows.repo.js';

// --- Topic types & repo ---

export type TopicStage = 'emerging' | 'fermenting' | 'peak' | 'declining' | 'retired';

export interface Topic {
  id: number;
  title: string;
  description: string;
  stage: TopicStage;
  heat: number;
  tags: string[];
  createdAt: number;
  peakAt: number | null;
  retiredAt: number | null;
}

interface TopicRow {
  id: number;
  title: string;
  description: string;
  stage: string;
  heat: number;
  tags: string;
  created_at: number;
  peak_at: number | null;
  retired_at: number | null;
}

function rowToTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    stage: row.stage as TopicStage,
    heat: row.heat,
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
    peakAt: row.peak_at,
    retiredAt: row.retired_at,
  };
}

const topicsRepo = {
  insert(db: WorldDb, input: { title: string; description: string; stage: TopicStage; heat: number; tags: string[]; createdAt: number }): number {
    const r = db.prepare('INSERT INTO topics (title, description, stage, heat, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      input.title, input.description, input.stage, input.heat, JSON.stringify(input.tags), input.createdAt,
    );
    return Number(r.lastInsertRowid);
  },
  findById(db: WorldDb, id: number): TopicRow | undefined {
    return db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as TopicRow | undefined;
  },
  listActive(db: WorldDb): TopicRow[] {
    return db.prepare("SELECT * FROM topics WHERE stage != 'retired' ORDER BY heat DESC").all() as TopicRow[];
  },
  listAll(db: WorldDb): TopicRow[] {
    return db.prepare('SELECT * FROM topics ORDER BY created_at DESC').all() as TopicRow[];
  },
  update(db: WorldDb, id: number, fields: Partial<{ title: string; description: string; stage: TopicStage; heat: number; tags: string[]; peakAt: number; retiredAt: number }>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fields.title !== undefined) { sets.push('title = ?'); params.push(fields.title); }
    if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description); }
    if (fields.stage !== undefined) { sets.push('stage = ?'); params.push(fields.stage); }
    if (fields.heat !== undefined) { sets.push('heat = ?'); params.push(fields.heat); }
    if (fields.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(fields.tags)); }
    if (fields.peakAt !== undefined) { sets.push('peak_at = ?'); params.push(fields.peakAt); }
    if (fields.retiredAt !== undefined) { sets.push('retired_at = ?'); params.push(fields.retiredAt); }
    if (sets.length === 0) return;
    params.push(id);
    db.prepare(`UPDATE topics SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  },
  remove(db: WorldDb, id: number): boolean {
    return db.prepare('DELETE FROM topics WHERE id = ?').run(id).changes > 0;
  },
};

export class AdminService {
  constructor(private readonly worldManager: WorldManager) {}

  async createPost(input: {
    authorId: number;
    content: string;
    createdAt?: number;
    replyToId?: number;
    quoteOfId?: number;
  }): Promise<{ id: number }> {
    const { db, clock } = this.worldManager.current();

    const content = (input.content ?? '').trim();
    if (!content) throw new ValidationError('content is required');

    const authorExists = db
      .prepare('SELECT 1 FROM users WHERE id = ?')
      .get(input.authorId);
    if (!authorExists) throw new NotFoundError(`User ${input.authorId} not found`);

    const createdAt = input.createdAt ?? clock.now();

    if (input.replyToId) {
      const parent = postsRepo.findById(db, input.replyToId);
      if (!parent) throw new NotFoundError(`Parent post ${input.replyToId} not found`);
    }

    if (input.quoteOfId) {
      const quoted = postsRepo.findById(db, input.quoteOfId);
      if (!quoted) throw new NotFoundError(`Quoted post ${input.quoteOfId} not found`);
    }

    const postId = db.transaction(() => {
      const id = postsRepo.insert(db, {
        authorId: input.authorId,
        content,
        replyToId: input.replyToId ?? null,
        quoteOfId: input.quoteOfId ?? null,
        createdAt,
      });

      if (input.replyToId) {
        db.prepare('UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?')
          .run(input.replyToId);
      }
      if (input.quoteOfId) {
        db.prepare('UPDATE posts SET quote_count = quote_count + 1 WHERE id = ?')
          .run(input.quoteOfId);
      }

      return id;
    })();

    return { id: postId };
  }

  bulkFollow(pairs: Array<{ followerId: number; followeeId: number }>): { created: number } {
    const { db, clock } = this.worldManager.current();
    const now = clock.now();
    let created = 0;

    db.transaction(() => {
      for (const { followerId, followeeId } of pairs) {
        if (followerId === followeeId) continue;
        const ok = followsRepo.insert(db, followerId, followeeId, now);
        if (ok) created++;
      }
    })();

    return { created };
  }

  updateCounts(postId: number, deltas: {
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    viewCount?: number;
  }): void {
    const { db } = this.worldManager.current();

    const post = postsRepo.findById(db, postId);
    if (!post) throw new NotFoundError(`Post ${postId} not found`);

    const sets: string[] = [];
    const params: number[] = [];

    if (deltas.likeCount) { sets.push('like_count = like_count + ?'); params.push(deltas.likeCount); }
    if (deltas.repostCount) { sets.push('repost_count = repost_count + ?'); params.push(deltas.repostCount); }
    if (deltas.replyCount) { sets.push('reply_count = reply_count + ?'); params.push(deltas.replyCount); }
    if (deltas.viewCount) { sets.push('view_count = view_count + ?'); params.push(deltas.viewCount); }

    if (sets.length === 0) return;

    db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...params, postId);
  }

  async bulkImport(input: {
    posts?: Array<{ authorId: number; content: string; createdAt?: number; replyToId?: number }>;
    follows?: Array<{ followerId: number; followeeId: number }>;
    counts?: Array<{ postId: number; likeCount?: number; repostCount?: number; viewCount?: number }>;
  }): Promise<{ postsCreated: number; followsCreated: number; countsUpdated: number }> {
    let postsCreated = 0;
    let followsCreated = 0;
    let countsUpdated = 0;

    if (input.posts?.length) {
      for (const post of input.posts) {
        await this.createPost(post);
        postsCreated++;
      }
    }

    if (input.follows?.length) {
      const result = this.bulkFollow(input.follows);
      followsCreated = result.created;
    }

    if (input.counts?.length) {
      for (const c of input.counts) {
        this.updateCounts(c.postId, c);
        countsUpdated++;
      }
    }

    return { postsCreated, followsCreated, countsUpdated };
  }

  // --- Topics ---

  listTopics(activeOnly = false): Topic[] {
    const { db } = this.worldManager.current();
    const rows = activeOnly ? topicsRepo.listActive(db) : topicsRepo.listAll(db);
    return rows.map(rowToTopic);
  }

  createTopic(input: { title: string; description?: string; heat?: number; tags?: string[] }): Topic {
    const { db, clock } = this.worldManager.current();
    if (!input.title?.trim()) throw new ValidationError('title is required');
    const id = topicsRepo.insert(db, {
      title: input.title.trim(),
      description: input.description ?? '',
      stage: 'emerging',
      heat: input.heat ?? 0.5,
      tags: input.tags ?? [],
      createdAt: clock.now(),
    });
    return rowToTopic(topicsRepo.findById(db, id)!);
  }

  updateTopic(id: number, fields: { title?: string; description?: string; stage?: TopicStage; heat?: number; tags?: string[] }): Topic {
    const { db, clock } = this.worldManager.current();
    const row = topicsRepo.findById(db, id);
    if (!row) throw new NotFoundError(`Topic ${id} not found`);

    const update: Parameters<typeof topicsRepo.update>[2] = {};
    if (fields.title !== undefined) update.title = fields.title;
    if (fields.description !== undefined) update.description = fields.description;
    if (fields.heat !== undefined) update.heat = fields.heat;
    if (fields.tags !== undefined) update.tags = fields.tags;
    if (fields.stage !== undefined) {
      update.stage = fields.stage;
      if (fields.stage === 'peak' && !row.peak_at) update.peakAt = clock.now();
      if (fields.stage === 'retired' && !row.retired_at) update.retiredAt = clock.now();
    }
    topicsRepo.update(db, id, update);
    return rowToTopic(topicsRepo.findById(db, id)!);
  }

  deleteTopic(id: number): void {
    const { db } = this.worldManager.current();
    if (!topicsRepo.remove(db, id)) throw new NotFoundError(`Topic ${id} not found`);
  }

  // --- Content Pools ---

  getContentPools(): { scenePools: Record<string, string[]>; topicPools: Record<string, string[]> } {
    return this.loadPools();
  }

  addToPool(poolType: 'scene' | 'topic', key: string, items: string[]): void {
    const pools = this.loadPools();
    const target = poolType === 'scene' ? pools.scenePools : pools.topicPools;
    if (!target[key]) target[key] = [];
    target[key].push(...items);
    this.savePools(pools);
  }

  clearPool(poolType: 'scene' | 'topic', key: string): void {
    const pools = this.loadPools();
    const target = poolType === 'scene' ? pools.scenePools : pools.topicPools;
    delete target[key];
    this.savePools(pools);
  }

  private poolsPath(): string {
    const ctx = this.worldManager.current();
    return path.join(this.worldManager.getWorldDir(ctx.worldId), 'content-pools.json');
  }

  private loadPools(): { scenePools: Record<string, string[]>; topicPools: Record<string, string[]> } {
    const filePath = this.poolsPath();
    if (!fs.existsSync(filePath)) return { scenePools: {}, topicPools: {} };
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
    return JSON.parse(raw);
  }

  private savePools(pools: { scenePools: Record<string, string[]>; topicPools: Record<string, string[]> }): void {
    fs.writeFileSync(this.poolsPath(), JSON.stringify(pools, null, 2), 'utf-8');
  }

  listUsers(): Array<{ id: number; handle: string; displayName: string; isBot: number }> {
    const { db } = this.worldManager.current();
    return db.prepare('SELECT id, handle, display_name AS displayName, is_bot AS isBot FROM users ORDER BY id').all() as any[];
  }

  getSimulatorStatus(): {
    running: boolean;
    tickNumber: number;
    entityCount: number;
    uptime: number;
    recentActions: Array<{ time: string; actor: string; action: string; detail: string }>;
  } {
    return {
      running: false,
      tickNumber: 0,
      entityCount: 0,
      uptime: 0,
      recentActions: [],
    };
  }
}
