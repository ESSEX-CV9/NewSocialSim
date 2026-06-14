import { logger } from '../logger.js';

export type TaskPriority = 'urgent' | 'normal' | 'low';

interface QueuedTask<T> {
  priority: TaskPriority;
  label: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  enqueuedAt: number;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, normal: 1, low: 2 };
const SOFT_EXPIRE_MS = 5 * 60_000;

export class LLMScheduler {
  private queue: QueuedTask<unknown>[] = [];
  private running = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = 2) {
    this.maxConcurrent = maxConcurrent;
  }

  enqueue<T>(priority: TaskPriority, label: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ priority, label, fn, resolve: resolve as (v: unknown) => void, reject, enqueuedAt: Date.now() });
      this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
      logger.info(`[Scheduler] Enqueued "${label}" (${priority}), queue size: ${this.queue.length}`);
      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const now = Date.now();
      const idx = this.queue.findIndex(t => t.priority !== 'urgent' && now - t.enqueuedAt < SOFT_EXPIRE_MS || t.priority === 'urgent');
      if (idx < 0 && this.queue.length > 0) {
        const expired = this.queue.shift()!;
        logger.warn(`[Scheduler] Expired "${expired.label}" (waited ${((now - expired.enqueuedAt) / 1000).toFixed(0)}s)`);
        expired.reject(new Error('Task expired'));
        continue;
      }

      const task = this.queue.splice(idx >= 0 ? idx : 0, 1)[0]!;
      this.running++;
      task.fn()
        .then(v => task.resolve(v))
        .catch(e => task.reject(e))
        .finally(() => { this.running--; this.drain(); });
    }
  }

  getQueueSize(): number { return this.queue.length; }
  getRunningCount(): number { return this.running; }
}
