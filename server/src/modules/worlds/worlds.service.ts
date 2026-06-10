import type { ActiveWorldInfo, WorldMeta, WorldSummary } from '@socialsim/shared';
import type { CreateWorldInput, WorldManager } from '../../core/world/world-manager.js';

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
}
