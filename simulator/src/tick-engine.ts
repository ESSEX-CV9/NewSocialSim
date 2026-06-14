import type { System, TickContext } from './ecs/types.js';
import { EntityRegistry } from './ecs/entity-registry.js';
import { logger } from './logger.js';

export class TickEngine {
  private tickNumber = 0;
  private lastTickTime = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private registry: EntityRegistry,
    private systems: System[],
    private tickIntervalMs: number,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickTime = Date.now();
    logger.info(`Tick engine started (interval: ${this.tickIntervalMs}ms, entities: ${this.registry.count()})`);
    this.scheduleNextTick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Tick engine stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  getTickNumber(): number {
    return this.tickNumber;
  }

  getEntityCount(): number {
    return this.registry.count();
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), this.tickIntervalMs);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    const now = Date.now();
    const deltaMs = now - this.lastTickTime;
    this.lastTickTime = now;
    this.tickNumber++;

    const ctx: TickContext = {
      simTime: now,
      tickNumber: this.tickNumber,
      deltaMs,
    };

    const entities = this.registry.getAll();
    logger.info(`Tick #${this.tickNumber} (${entities.length} entities, delta: ${deltaMs}ms)`);

    for (const system of this.systems) {
      try {
        await system.update(entities, ctx);
      } catch (err) {
        logger.error(`System ${system.name} error:`, err);
      }
    }

    this.scheduleNextTick();
  }
}
