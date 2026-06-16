import path from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { SimTraceEvent } from '@socialsim/shared';
import { logger } from '../logger.js';

/**
 * 决策轨迹 sink：把模拟器每次写世界的轨迹落到该世界独占的 sim-trace.db。
 * 分库原则：轨迹属观测线，模拟器独占、绝不进社交站 world.db。
 * 库随活动世界切换：setWorld 关旧库、开新库。落盘失败降级（记一次告警后静默），不中断写世界。
 */
export class TraceSink {
  private db: Database.Database | null = null;
  private insertStmt: Database.Statement | null = null;
  private worldId: string | null = null;

  constructor(private dataDir: string) {}

  /** 切到某世界的轨迹库；同世界重复调用为 no-op。 */
  setWorld(worldId: string): void {
    if (this.worldId === worldId && this.db) return;
    this.close();
    try {
      const dir = path.join(this.dataDir, 'worlds', worldId);
      mkdirSync(dir, { recursive: true });
      const dbPath = path.join(dir, 'sim-trace.db');
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.exec(`
        CREATE TABLE IF NOT EXISTS trace_event (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          sim_time INTEGER NOT NULL,
          entity TEXT NOT NULL,
          action TEXT NOT NULL,
          activity_state TEXT,
          intent TEXT,
          shape TEXT,
          pool_id TEXT,
          entry_id TEXT,
          media_attached INTEGER NOT NULL DEFAULT 0,
          media_reason TEXT,
          target_post_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_trace_sim_time ON trace_event(sim_time);
        CREATE INDEX IF NOT EXISTS idx_trace_entity_sim_time ON trace_event(entity, sim_time);
      `);
      if (db.pragma('user_version', { simple: true }) === 0) {
        db.pragma('user_version = 1');
      }
      this.insertStmt = db.prepare(`
        INSERT INTO trace_event
          (at, sim_time, entity, action, activity_state, intent, shape, pool_id, entry_id, media_attached, media_reason, target_post_id)
        VALUES
          (@at, @simTime, @entity, @action, @activityState, @intent, @shape, @poolId, @entryId, @mediaAttached, @mediaReason, @targetPostId)
      `);
      this.db = db;
      this.worldId = worldId;
      logger.info(`Trace sink bound to ${dbPath}`);
    } catch (err) {
      logger.error(`Trace sink failed to open world ${worldId} (continuing without trace):`, err);
      this.db = null;
      this.insertStmt = null;
      this.worldId = null;
    }
  }

  emit(event: SimTraceEvent): void {
    if (!this.insertStmt) return;
    try {
      this.insertStmt.run({
        at: event.at,
        simTime: event.simTime,
        entity: event.entity,
        action: event.action,
        activityState: event.activityState ?? null,
        intent: event.intent ?? null,
        shape: event.shape ?? null,
        poolId: event.poolId ?? null,
        entryId: event.entryId ?? null,
        mediaAttached: event.mediaAttached ? 1 : 0,
        mediaReason: event.mediaReason ?? null,
        targetPostId: event.targetPostId ?? null,
      });
    } catch (err) {
      logger.error('Trace sink emit failed:', err);
    }
  }

  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
    }
    this.db = null;
    this.insertStmt = null;
    this.worldId = null;
  }
}
