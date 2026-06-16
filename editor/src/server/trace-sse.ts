import type { ServerResponse } from 'node:http';
import type { StoredSimTraceEvent } from '@socialsim/shared';

/**
 * 轨迹 SSE 中枢（编辑器后端）：时间轴面板订阅，模拟器经 ingest 端点推来的新轨迹即时转发。
 * 0.9 阶段只接连接 + 心跳"空推"，broadcast 留给 0.11 轨迹实时推送接入。
 * 单进程内存态，连接随 renderer 标签存活。
 */

/** 防空闲断连的注释行心跳。 */
const HEARTBEAT_INTERVAL_MS = 25_000;

export class TraceSseHub {
  private readonly clients = new Set<ServerResponse>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** 登记连接（调用方已写好 SSE 响应头）；返回注销函数，挂到连接 close。 */
  addClient(raw: ServerResponse): () => void {
    this.clients.add(raw);
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => this.ping(), HEARTBEAT_INTERVAL_MS);
      this.heartbeatTimer.unref();
    }
    return () => {
      this.clients.delete(raw);
      this.stopHeartbeatIfIdle();
    };
  }

  /** 向所有订阅者推一条轨迹事件（0.11 由 ingest 端点调用）。 */
  broadcast(event: StoredSimTraceEvent): void {
    const chunk = `event: trace\ndata: ${JSON.stringify(event)}\n\n`;
    for (const raw of [...this.clients]) this.write(raw, chunk);
  }

  size(): number {
    return this.clients.size;
  }

  private ping(): void {
    for (const raw of [...this.clients]) this.write(raw, ': ping\n\n');
  }

  private write(raw: ServerResponse, chunk: string): void {
    if (raw.writableEnded || raw.destroyed) {
      this.clients.delete(raw);
      return;
    }
    try {
      raw.write(chunk);
    } catch {
      this.clients.delete(raw);
    }
  }

  private stopHeartbeatIfIdle(): void {
    if (this.clients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
