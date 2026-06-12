import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/**
 * 二进制下载与解压工具（实例级基础设施，与世界无关）。
 * 下载用全局 fetch：自动跟随 GitHub release 的 302 重定向，
 * 且走 undici 全局 dispatcher——media-search.json 配置的代理自动生效。
 */

/** 停滞超时：只要还在收数据就不杀（大文件经代理可能很慢但仍在推进），停滞 90 秒才判失败 */
const STALL_TIMEOUT_MS = 90_000;

export async function downloadToFile(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number | null) => void,
): Promise<void> {
  const controller = new AbortController();
  let stallTimer: NodeJS.Timeout | null = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(new Error('下载停滞（90 秒无数据）')), STALL_TIMEOUT_MS);
  };
  resetStall();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'NewSocialSim-tools' },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`下载失败：HTTP ${res.status}`);
    }
    const total = Number(res.headers.get('content-length')) || null;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    let downloaded = 0;
    const body = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
    body.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      resetStall();
      onProgress(downloaded, total);
    });
    await pipeline(body, fs.createWriteStream(destPath));
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}

/**
 * 经 PowerShell Expand-Archive 解压（项目 Windows 优先，不引 zip 依赖）。
 * 命令经 -EncodedCommand（UTF-16LE base64）传递——含中文的路径不经任何代码页转换；
 * 命令内先把输出编码切到 UTF-8，stderr 报错不再按 GBK 输出导致乱码。
 */
export function expandZip(zipPath: string, destDir: string): Promise<void> {
  if (!fs.existsSync(zipPath)) {
    return Promise.reject(new Error(`压缩包不存在：${zipPath}`));
  }
  const psCommand =
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`;
  const encoded = Buffer.from(psCommand, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('解压超时'));
    }, 120_000);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Expand-Archive 退出码 ${code}`));
    });
  });
}

/** 在 dir 下递归查找指定文件名（zip 内层目录名随版本变化，不写死） */
export function findFileIn(dir: string, fileName: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const found = findFileIn(full, fileName);
      if (found) return found;
    }
  }
  return null;
}

/** Windows 下刚结束的进程可能仍锁定文件/目录，删除带重试 */
export async function rmWithRetry(target: string, attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
