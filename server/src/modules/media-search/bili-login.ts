import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { locateBrowser } from './browser-locator.js';
import { patchSearchConfig } from './search-config.js';
import type { LoginStatus, LoginState } from './pixiv-login.js';

const LOGIN_URL = 'https://passport.bilibili.com/login';
const TOTAL_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
}

/**
 * B站 CDP 引导登录（与 Pixiv 同范式，开箱即用）：spawn 本机浏览器（独立调试端口 + 临时
 * profile）打开 B站登录页（支持扫码），经浏览器级 DevTools 轮询 Cookie，出现登录态
 * （SESSDATA）后把全部 bilibili Cookie 自动写入配置并关浏览器。同一时间只允许一个流程。
 */
export class BiliLoginFlow {
  private state: LoginState = 'idle';
  private message: string | undefined;
  private proc: ChildProcess | null = null;
  private profileDir: string | null = null;
  private ws: WebSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private msgId = 0;
  private captured = false;

  status(): LoginStatus {
    return {
      state: this.state,
      ...(this.message ? { message: this.message } : {}),
      loginUrl: LOGIN_URL,
    };
  }

  async start(): Promise<LoginStatus> {
    if (this.state === 'launching' || this.state === 'waiting' || this.state === 'exchanging') {
      return this.status();
    }
    this.cleanup();
    this.captured = false;
    this.message = undefined;

    const browser = locateBrowser();
    if (!browser) {
      this.state = 'error';
      this.message = '未找到 Chrome/Edge，可手动粘贴浏览器 Cookie 兜底';
      return this.status();
    }

    this.state = 'launching';
    try {
      const port = await freePort();
      this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'socialsim-bili-login-'));
      this.proc = spawn(
        browser,
        [
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${this.profileDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          LOGIN_URL,
        ],
        { stdio: 'ignore' },
      );
      this.proc.on('exit', () => {
        if (this.state === 'launching' || this.state === 'waiting') {
          this.fail('浏览器已关闭，登录未完成');
        }
      });

      this.state = 'waiting';
      this.pollTimer = setInterval(() => void this.poll(port), POLL_INTERVAL_MS);
      this.timeoutTimer = setTimeout(() => this.fail('登录超时（5 分钟）'), TOTAL_TIMEOUT_MS);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
    return this.status();
  }

  /** 每个轮询 tick：保证浏览器级 WebSocket 连接存在，并请求一次全部 Cookie */
  private async poll(port: number): Promise<void> {
    if (this.state !== 'waiting') return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(2000),
        });
        const info = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (!info.webSocketDebuggerUrl) return;
        this.connect(info.webSocketDebuggerUrl);
      } catch {
        return; // 浏览器尚未就绪或已退出
      }
      return; // 连接建立后下个 tick 再查
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      // Storage.getCookies 是浏览器级命令（Network.getAllCookies 的现行替代）
      this.ws.send(JSON.stringify({ id: ++this.msgId, method: 'Storage.getCookies' }));
    }
  }

  private connect(wsUrl: string): void {
    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as { result?: { cookies?: CdpCookie[] } };
          const cookies = msg.result?.cookies;
          if (cookies) this.checkCookies(cookies);
        } catch {
          // 非 JSON 或无关消息
        }
      };
      ws.onerror = () => {
        // 下个 tick 会重连
      };
    } catch {
      this.ws = null;
    }
  }

  /** 出现 SESSDATA（登录态）即捕获全部 bilibili 域 Cookie 写入配置 */
  private checkCookies(cookies: CdpCookie[]): void {
    if (this.captured || this.state !== 'waiting') return;
    const bili = cookies.filter((c) => c.domain.endsWith('bilibili.com'));
    if (!bili.some((c) => c.name === 'SESSDATA' && c.value)) return;
    this.captured = true;
    this.state = 'exchanging';
    try {
      const cookieStr = bili.map((c) => `${c.name}=${c.value}`).join('; ');
      patchSearchConfig({ bilibili: { cookies: cookieStr } });
      this.state = 'success';
      this.message = undefined;
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      this.cleanup();
    }
  }

  private fail(message: string): void {
    this.state = 'error';
    this.message = message;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // 忽略
      }
      this.ws = null;
    }
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill();
      } catch {
        // 忽略
      }
    }
    this.proc = null;
    if (this.profileDir) {
      removeDirWithRetry(this.profileDir);
      this.profileDir = null;
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('无法获取空闲端口')));
      }
    });
    srv.on('error', reject);
  });
}

/** 浏览器退出后 profile 目录可能短暂被锁（EBUSY），重试几次后放弃（残留临时目录无害） */
function removeDirWithRetry(dir: string, attempts = 3): void {
  setTimeout(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      if (attempts > 1) removeDirWithRetry(dir, attempts - 1);
    }
  }, 1500);
}
