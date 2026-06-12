import type { ServerResponse } from 'node:http';

interface SseConnection {
  userId: number;
  worldId: string;
  raw: ServerResponse;
}

/** 防代理/浏览器空闲断连的注释行心跳（真实时间，属与世界无关的基础设施） */
const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * SSE 连接中枢（core 级基础设施）：连接登记、按用户推送、心跳、世界热切换时清场。
 * 单进程内存态；连接登记时带上签发时的 worldId，推送时核对，
 * 热切换由 WorldManager.onActivated 触发 closeAll()——旧世界 token 重连会被 401。
 */
export class SseHub {
  private readonly connections = new Set<SseConnection>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** 登记连接（调用方已写好 SSE 响应头）；返回注销函数，必须挂到连接 close 事件 */
  addClient(userId: number, worldId: string, raw: ServerResponse): () => void {
    const conn: SseConnection = { userId, worldId, raw };
    this.connections.add(conn);
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => this.ping(), HEARTBEAT_INTERVAL_MS);
      this.heartbeatTimer.unref();
    }
    return () => {
      this.connections.delete(conn);
      this.stopHeartbeatIfIdle();
    };
  }

  /** 给某用户的全部连接（多标签页）推事件；worldId 不匹配的连接跳过 */
  sendToUser(worldId: string, userId: number, event: string, data: unknown): void {
    for (const conn of [...this.connections]) {
      if (conn.userId === userId && conn.worldId === worldId) {
        this.write(conn, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    }
  }

  /** 热切换/进程退出时调用：通知后逐个断开 */
  closeAll(): void {
    for (const conn of [...this.connections]) {
      this.write(conn, 'event: shutdown\ndata: {}\n\n');
      try {
        conn.raw.end();
      } catch {
        // 连接已死，忽略
      }
    }
    this.connections.clear();
    this.stopHeartbeatIfIdle();
  }

  /** 当前连接数（验证/调试用） */
  size(): number {
    return this.connections.size;
  }

  private ping(): void {
    for (const conn of [...this.connections]) {
      this.write(conn, ': ping\n\n');
    }
  }

  private write(conn: SseConnection, chunk: string): void {
    if (conn.raw.writableEnded || conn.raw.destroyed) {
      this.connections.delete(conn);
      return;
    }
    try {
      conn.raw.write(chunk);
    } catch {
      this.connections.delete(conn);
    }
  }

  private stopHeartbeatIfIdle(): void {
    if (this.connections.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
