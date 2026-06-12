import type { MediaView } from '@socialsim/shared';
import { AppError } from '../../core/errors/app-error.js';

/**
 * 视频引入异步任务管理器（进程内，重启即丢——已入库媒体不受影响）。
 * 每用户并发 2，超出排队；终态任务保留 30 分钟供前端展示后清扫。
 */

export type VideoTaskStatus = 'pending' | 'probing' | 'downloading' | 'done' | 'error' | 'canceled';

export type VideoErrorCode =
  | 'TOOL_MISSING'
  | 'URL_UNSUPPORTED'
  | 'TOO_LARGE'
  | 'HLS_ONLY'
  | 'WORLD_CHANGED'
  | 'RATING_BLOCKED'
  | 'TIMEOUT'
  | 'CANCELED'
  | 'TASK_LIMIT'
  | 'FAILED';

/** 任务执行流抛出带码错误用；service 层守门直接抛 AppError */
export class VideoTaskError extends Error {
  constructor(
    public readonly code: VideoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VideoTaskError';
  }
}

export interface VideoTaskView {
  id: string;
  url: string;
  mode: 'download' | 'stream';
  status: VideoTaskStatus;
  /** 下载阶段 0-100 */
  progress: number;
  totalBytes?: number | null;
  title?: string;
  errorCode?: VideoErrorCode;
  errorMessage?: string;
  media?: MediaView;
  /** 模拟时间（展示用） */
  createdAt: number;
}

export interface VideoTask extends VideoTaskView {
  userId: number;
  worldId: string;
  abort: AbortController;
}

type TaskRunner = (task: VideoTask) => Promise<MediaView>;

const MAX_RUNNING_PER_USER = 2;
const MAX_QUEUED_PER_USER = 10;
/** 终态保留时长（真实墙钟——进程内展示缓存，与模拟时间无关） */
const TERMINAL_KEEP_MS = 30 * 60_000;
const TERMINAL: VideoTaskStatus[] = ['done', 'error', 'canceled'];

interface Entry {
  task: VideoTask;
  run: TaskRunner;
  /** 终态时刻（真实墙钟，清扫用） */
  endedAtReal?: number;
}

let seq = 0;

export class VideoTaskManager {
  private readonly entries = new Map<string, Entry>();

  /** 是否有任意用户的任务在执行（tools 安装期间拒绝覆盖二进制用） */
  hasRunning(): boolean {
    for (const e of this.entries.values()) {
      if (e.task.status === 'probing' || e.task.status === 'downloading') return true;
    }
    return false;
  }

  enqueue(
    userId: number,
    worldId: string,
    input: { url: string; mode: 'download' | 'stream'; createdAt: number },
    run: TaskRunner,
  ): VideoTaskView {
    this.sweep();
    const mine = [...this.entries.values()].filter(
      (e) => e.task.userId === userId && !TERMINAL.includes(e.task.status),
    );
    if (mine.length >= MAX_RUNNING_PER_USER + MAX_QUEUED_PER_USER) {
      throw new AppError(400, 'TASK_LIMIT', '排队中的视频任务过多，请稍后再试');
    }
    const task: VideoTask = {
      id: `vt${++seq}-${Math.random().toString(36).slice(2, 8)}`,
      url: input.url,
      mode: input.mode,
      status: 'pending',
      progress: 0,
      createdAt: input.createdAt,
      userId,
      worldId,
      abort: new AbortController(),
    };
    this.entries.set(task.id, { task, run });
    this.pump(userId);
    return this.view(task);
  }

  get(userId: number, id: string): VideoTaskView {
    const e = this.entries.get(id);
    if (!e || e.task.userId !== userId) {
      throw new AppError(404, 'NOT_FOUND', `任务 ${id} 不存在`);
    }
    return this.view(e.task);
  }

  /** 本人全部未清扫任务（新→旧） */
  listForUser(userId: number): VideoTaskView[] {
    this.sweep();
    return [...this.entries.values()]
      .filter((e) => e.task.userId === userId)
      .sort((a, b) => b.task.createdAt - a.task.createdAt)
      .map((e) => this.view(e.task));
  }

  cancel(userId: number, id: string): VideoTaskView {
    const e = this.entries.get(id);
    if (!e || e.task.userId !== userId) {
      throw new AppError(404, 'NOT_FOUND', `任务 ${id} 不存在`);
    }
    if (!TERMINAL.includes(e.task.status)) {
      e.task.abort.abort();
      this.finish(e, 'canceled', { code: 'CANCELED', message: '已取消' });
    }
    return this.view(e.task);
  }

  /** 若该用户运行数未满则启动队首 pending 任务 */
  private pump(userId: number): void {
    const mine = [...this.entries.values()].filter((e) => e.task.userId === userId);
    const running = mine.filter(
      (e) => e.task.status === 'probing' || e.task.status === 'downloading',
    ).length;
    if (running >= MAX_RUNNING_PER_USER) return;
    const next = mine
      .filter((e) => e.task.status === 'pending')
      .sort((a, b) => a.task.createdAt - b.task.createdAt)[0];
    if (!next) return;
    next.task.status = 'probing';
    void next
      .run(next.task)
      .then((media) => {
        if (TERMINAL.includes(next.task.status)) return; // 已被取消
        next.task.media = media;
        this.finish(next, 'done');
      })
      .catch((err: unknown) => {
        if (TERMINAL.includes(next.task.status)) return;
        if (next.task.abort.signal.aborted) {
          this.finish(next, 'canceled', { code: 'CANCELED', message: '已取消' });
        } else if (err instanceof VideoTaskError) {
          this.finish(next, 'error', { code: err.code, message: err.message });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          const code: VideoErrorCode = message.includes('超时') ? 'TIMEOUT' : 'FAILED';
          this.finish(next, 'error', { code, message });
        }
      })
      .finally(() => this.pump(userId));
  }

  private finish(
    e: Entry,
    status: 'done' | 'error' | 'canceled',
    err?: { code: VideoErrorCode; message: string },
  ): void {
    e.task.status = status;
    if (err) {
      e.task.errorCode = err.code;
      e.task.errorMessage = err.message;
    }
    e.endedAtReal = Date.now();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, e] of this.entries) {
      if (e.endedAtReal !== undefined && now - e.endedAtReal > TERMINAL_KEEP_MS) {
        this.entries.delete(id);
      }
    }
  }

  private view(task: VideoTask): VideoTaskView {
    const v: VideoTaskView = {
      id: task.id,
      url: task.url,
      mode: task.mode,
      status: task.status,
      progress: task.progress,
      createdAt: task.createdAt,
    };
    if (task.totalBytes !== undefined) v.totalBytes = task.totalBytes;
    if (task.title !== undefined) v.title = task.title;
    if (task.errorCode !== undefined) v.errorCode = task.errorCode;
    if (task.errorMessage !== undefined) v.errorMessage = task.errorMessage;
    if (task.media !== undefined) v.media = task.media;
    return v;
  }
}
