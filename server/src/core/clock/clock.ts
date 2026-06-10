import type { ClockState } from '@socialsim/shared';
import { ValidationError } from '../errors/app-error.js';

/**
 * 业务代码唯一允许的时间来源。
 * 任何模块都不得直接调用 Date.now() —— 那是真实时间，不是世界的时间。
 */
export interface IClock {
  /** 当前模拟时间（unix 毫秒形式） */
  now(): number;
}

/**
 * 可加速、可暂停的模拟时钟。
 * 模拟时间 = 锚点模拟时间 + 真实流逝 × 流速；
 * 修改流速/暂停时先把"此刻"固化为新锚点，保证时间连续不跳变。
 */
export class SimClock implements IClock {
  private anchorSimMs: number;
  private anchorRealMs: number;
  private scale: number;
  private paused: boolean;

  constructor(state: ClockState) {
    this.anchorSimMs = state.simTimeMs;
    this.anchorRealMs = Date.now();
    this.scale = state.scale;
    this.paused = state.paused;
  }

  now(): number {
    if (this.paused) return this.anchorSimMs;
    return Math.floor(this.anchorSimMs + (Date.now() - this.anchorRealMs) * this.scale);
  }

  setScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new ValidationError(`时钟流速必须为正数，收到 ${scale}（暂停请用 pause）`);
    }
    this.reanchor();
    this.scale = scale;
  }

  pause(): void {
    this.reanchor();
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.anchorRealMs = Date.now();
    this.paused = false;
  }

  /** 直接设定模拟时间（上帝操作，谨慎使用：可制造时间倒流） */
  setTime(simTimeMs: number): void {
    this.anchorSimMs = simTimeMs;
    this.anchorRealMs = Date.now();
  }

  /** 导出当前状态用于持久化到 world.json */
  snapshot(): ClockState {
    return { simTimeMs: this.now(), scale: this.scale, paused: this.paused };
  }

  private reanchor(): void {
    this.anchorSimMs = this.now();
    this.anchorRealMs = Date.now();
  }
}
