import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ValidationError } from '../../core/errors/app-error.js';
import { locateBrowser } from './browser-locator.js';
import { patchSearchConfig } from './search-config.js';

/** Pixiv 官方 Android 客户端的公开 OAuth 凭证（社区通用，多年未变） */
const CLIENT_ID = 'MOBrBDS8blbauoSck0ZfDbtuzpyT';
const CLIENT_SECRET = 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj';
const LOGIN_BASE = 'https://app-api.pixiv.net/web/v1/login';
const REDIRECT_URI = 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback';
const TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token';
const TOTAL_TIMEOUT_MS = 5 * 60 * 1000;
const SCAN_INTERVAL_MS = 700;

export type LoginState = 'idle' | 'launching' | 'waiting' | 'exchanging' | 'success' | 'error';

export interface LoginStatus {
  state: LoginState;
  message?: string;
  /** 手动模式用：浏览器探测失败或想自己开浏览器时访问此 URL 登录 */
  loginUrl?: string;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * CDP 引导登录状态机：spawn 本机浏览器（独立调试端口 + 临时 profile）打开 Pixiv 登录页，
 * 经 DevTools 协议监听 pixiv://account/login?code= 回调，自动换取 refresh token。
 * 同一时间只允许一个登录流程。
 */
export class PixivLoginFlow {
  private state: LoginState = 'idle';
  private message: string | undefined;
  private verifier: string | null = null;
  private loginUrl: string | null = null;
  private proc: ChildProcess | null = null;
  private profileDir: string | null = null;
  private sockets: WebSocket[] = [];
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private attachedTargets = new Set<string>();
  private codeHandled = false;

  status(): LoginStatus {
    return {
      state: this.state,
      ...(this.message ? { message: this.message } : {}),
      ...(this.loginUrl ? { loginUrl: this.loginUrl } : {}),
    };
  }

  /** 生成 PKCE 与登录 URL（CDP 自动流程与手动粘贴流程共用） */
  private preparePkce(): string {
    this.verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(this.verifier).digest());
    this.loginUrl = `${LOGIN_BASE}?code_challenge=${challenge}&code_challenge_method=S256&client=pixiv-android`;
    return this.loginUrl;
  }

  async start(): Promise<LoginStatus> {
    if (this.state === 'launching' || this.state === 'waiting' || this.state === 'exchanging') {
      return this.status();
    }
    this.cleanup();
    this.codeHandled = false;
    this.message = undefined;
    const loginUrl = this.preparePkce();

    const browser = locateBrowser();
    if (!browser) {
      // 没找到浏览器：保留 loginUrl 供手动模式
      this.state = 'error';
      this.message = '未找到 Chrome/Edge，可手动打开登录链接后粘贴 code';
      return this.status();
    }

    this.state = 'launching';
    try {
      const port = await freePort();
      this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'socialsim-pixiv-login-'));
      this.proc = spawn(
        browser,
        [
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${this.profileDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          loginUrl,
        ],
        { stdio: 'ignore' },
      );
      this.proc.on('exit', () => {
        if (this.state === 'launching' || this.state === 'waiting') {
          this.fail('浏览器已关闭，登录未完成');
        }
      });

      this.state = 'waiting';
      this.scanTimer = setInterval(() => void this.scanTargets(port), SCAN_INTERVAL_MS);
      this.timeoutTimer = setTimeout(() => this.fail('登录超时（5 分钟）'), TOTAL_TIMEOUT_MS);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
    return this.status();
  }

  /** 轮询 /json/list，对每个新页面 target 建 WebSocket 监听导航事件 */
  private async scanTargets(port: number): Promise<void> {
    if (this.state !== 'waiting') return;
    let targets: { id: string; type: string; webSocketDebuggerUrl?: string }[];
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(2000),
      });
      targets = (await res.json()) as typeof targets;
    } catch {
      return; // 浏览器尚未就绪或已退出
    }
    for (const target of targets) {
      if (target.type !== 'page' || !target.webSocketDebuggerUrl) continue;
      if (this.attachedTargets.has(target.id)) continue;
      this.attachedTargets.add(target.id);
      this.attach(target.webSocketDebuggerUrl);
    }
  }

  private attach(wsUrl: string): void {
    try {
      const ws = new WebSocket(wsUrl);
      this.sockets.push(ws);
      let msgId = 0;
      ws.onopen = () => {
        ws.send(JSON.stringify({ id: ++msgId, method: 'Network.enable' }));
        ws.send(JSON.stringify({ id: ++msgId, method: 'Page.enable' }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            method?: string;
            params?: { request?: { url?: string }; url?: string; frame?: { url?: string } };
          };
          const url =
            msg.params?.request?.url ?? msg.params?.url ?? msg.params?.frame?.url ?? '';
          if (url.startsWith('pixiv://account/login')) {
            const code = new URL(url).searchParams.get('code');
            if (code) void this.handleCode(code);
          }
        } catch {
          // 非 JSON 或无关消息
        }
      };
      ws.onerror = () => {
        // 单个 target 失败不影响整体（页面可能已关闭）
      };
    } catch {
      // 忽略
    }
  }

  /** 拿到授权码：换 refresh token 并写入配置 */
  private async handleCode(code: string): Promise<void> {
    if (this.codeHandled || !this.verifier) return;
    this.codeHandled = true;
    this.state = 'exchanging';
    try {
      const refreshToken = await exchangeToken(code, this.verifier);
      patchSearchConfig({ pixiv: { refreshToken } });
      this.state = 'success';
      this.message = undefined;
    } catch (err) {
      this.fail(`换取 token 失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      this.cleanup();
    }
  }

  /** 手动模式：用户粘贴 code 或完整 pixiv:// 回调 URL（必须先 start 过以生成 verifier） */
  async submitCode(input: string): Promise<LoginStatus> {
    if (!this.verifier) {
      throw new ValidationError('请先发起登录（生成登录链接后才能提交 code）');
    }
    let code = input.trim();
    if (code.includes('://') || code.includes('code=')) {
      const m = /[?&]code=([^&\s]+)/.exec(code);
      if (!m) throw new ValidationError('未能从输入中解析出 code');
      code = m[1]!;
    }
    this.codeHandled = false;
    await this.handleCode(code);
    return this.status();
  }

  private fail(message: string): void {
    this.state = 'error';
    this.message = message;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    for (const ws of this.sockets) {
      try {
        ws.close();
      } catch {
        // 忽略
      }
    }
    this.sockets = [];
    this.attachedTargets.clear();
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

async function exchangeToken(code: string, verifier: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
    include_policy: 'true',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'PixivAndroidApp/5.0.234 (Android 11; Pixel 5)',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { refresh_token?: string };
  if (!data.refresh_token) throw new Error('响应中没有 refresh_token');
  return data.refresh_token;
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
