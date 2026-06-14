import type { ActiveWorldInfo, ClockState, WorldMeta, WorldSummary } from '@socialsim/shared';
import type { CreateWorldInput, SnapshotInfo, WorldManager } from '../../core/world/world-manager.js';

/** 世界管理的业务入口。本模块没有 repo——数据落在文件系统，由 WorldManager 承担。 */
export class WorldsService {
  constructor(private readonly worldManager: WorldManager) {}

  list(): WorldSummary[] {
    return this.worldManager.list();
  }

  create(input: CreateWorldInput): WorldMeta {
    return this.worldManager.create(input);
  }

  activate(worldId: string): ActiveWorldInfo {
    const ctx = this.worldManager.activate(worldId);
    return { meta: ctx.meta, simTimeMs: ctx.clock.now() };
  }

  active(): ActiveWorldInfo {
    const ctx = this.worldManager.current();
    return { meta: ctx.meta, simTimeMs: ctx.clock.now() };
  }

  updateMeta(worldId: string, patch: {
    name?: string;
    description?: string;
    locale?: WorldMeta['locale'];
    contentRating?: WorldMeta['contentRating'];
    calendar?: { label: string };
  }): WorldMeta {
    return this.worldManager.updateMeta(worldId, patch);
  }

  clockControl(action: { type: 'pause' } | { type: 'resume' } | { type: 'setScale'; scale: number } | { type: 'setTime'; simTimeMs: number }): ClockState {
    return this.worldManager.clockControl(action);
  }

  copyWorld(sourceId: string, newId: string): WorldMeta {
    return this.worldManager.copyWorld(sourceId, newId);
  }

  createSnapshot(name: string, description?: string): SnapshotInfo {
    return this.worldManager.createSnapshot(name, description);
  }

  listSnapshots(worldId: string): SnapshotInfo[] {
    return this.worldManager.listSnapshots(worldId);
  }

  restoreSnapshot(name: string): void {
    this.worldManager.restoreSnapshot(name);
  }

  removeSnapshot(worldId: string, name: string): void {
    this.worldManager.removeSnapshot(worldId, name);
  }

  deleteWorld(worldId: string): void {
    this.worldManager.deleteWorld(worldId);
  }
}
