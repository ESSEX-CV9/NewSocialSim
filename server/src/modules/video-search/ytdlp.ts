import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolsService } from '../tools/tools.service.js';

/**
 * yt-dlp 子进程封装：probe（-J 元数据）/ searchFlatPlaylist（搜索候选）/ download（下载）。
 * 超时与取消一律 taskkill /t /f 杀进程树——yt-dlp 会派生 ffmpeg 子进程，proc.kill 杀不全。
 */

export interface ProgressiveFormat {
  url: string;
  httpHeaders: Record<string, string>;
  width: number | null;
  height: number | null;
}

export interface ProbeResult {
  id: string;
  title: string;
  /** 规范页面地址（作 origin_url 与去重键） */
  webpageUrl: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
  filesizeApprox: number | null;
  /** 最优"单文件渐进式 mp4"格式（D 期流式引用用）；无则 null */
  progressive: ProgressiveFormat | null;
}

export interface FlatEntry {
  url: string;
  title: string;
  durationMs: number | null;
  thumbnailUrl: string | null;
  uploader: string | null;
}

export interface DownloadResult {
  filePath: string;
  sizeBytes: number;
}

const PROBE_TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
/** 进度行示例：[download]  12.3% of ~  10.50MiB at    2.10MiB/s ETA 00:05 */
const PROGRESS_RE = /\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*([\d.]+)(K|M|G)iB)?/;

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  } catch {
    // 进程可能已退出
  }
}

function toBytes(num: string, unit: string): number {
  const n = Number(num);
  if (unit === 'K') return Math.round(n * 1024);
  if (unit === 'M') return Math.round(n * 1024 * 1024);
  return Math.round(n * 1024 * 1024 * 1024);
}

interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  onStdoutLine?: ((line: string) => void) | undefined;
}

/** 各方法的请求选项（cookie 用于 B站 等需要浏览器 Cookie 过风控的站点） */
export interface YtDlpRequestOpts {
  proxy?: string | undefined;
  cookie?: string | undefined;
}

/** 从 stderr 提取人类可读的错误：优先首个 ERROR: 行，限长 300 */
function pickErrorLine(stderrTail: string, exitCode: number | null): string {
  const lines = stderrTail
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const line = lines.find((l) => l.startsWith('ERROR:')) ?? lines.pop();
  return (line ?? `yt-dlp 退出码 ${exitCode}`).slice(0, 300);
}

export class YtDlp {
  constructor(private readonly tools: ToolsService) {}

  available(): boolean {
    return this.tools.ytdlpPath() !== null;
  }

  private commonArgs(opts: YtDlpRequestOpts): string[] {
    const args = ['--no-warnings', '--no-playlist'];
    if (opts.proxy) args.push('--proxy', opts.proxy);
    if (opts.cookie) args.push('--add-header', `Cookie: ${opts.cookie}`);
    const ffmpegDir = this.tools.ffmpegDir();
    if (ffmpegDir) args.push('--ffmpeg-location', ffmpegDir);
    return args;
  }

  /** spawn yt-dlp 收集 stdout；非 0 退出码以 stderr 尾部为错误信息 */
  private run(args: string[], opts: RunOptions): Promise<string> {
    const exe = this.tools.ytdlpPath();
    if (!exe) return Promise.reject(new Error('yt-dlp 未安装'));
    return new Promise((resolve, reject) => {
      const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderrTail = '';
      let lineBuf = '';
      let settled = false;
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(stdout);
      };
      const timer = setTimeout(() => {
        killTree(proc.pid);
        finish(new Error('yt-dlp 执行超时'));
      }, opts.timeoutMs);
      const onAbort = () => {
        killTree(proc.pid);
        finish(new Error('已取消'));
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      proc.stdout.on('data', (d: Buffer) => {
        const text = d.toString();
        stdout += text;
        if (opts.onStdoutLine) {
          lineBuf += text;
          let idx: number;
          while ((idx = lineBuf.indexOf('\n')) >= 0) {
            opts.onStdoutLine(lineBuf.slice(0, idx).trimEnd());
            lineBuf = lineBuf.slice(idx + 1);
          }
        }
      });
      proc.stderr.on('data', (d: Buffer) => {
        stderrTail = (stderrTail + d.toString()).slice(-4096);
      });
      proc.on('error', (err) => finish(err));
      proc.on('exit', (code) => {
        if (code === 0) {
          finish(null);
        } else {
          // 完整 stderr 进服务端 console——任务卡片只显示摘要，排查靠这里
          console.error(`[yt-dlp] 失败（退出码 ${code}）：yt-dlp ${args.join(' ')}\n${stderrTail.trim()}`);
          finish(new Error(pickErrorLine(stderrTail, code)));
        }
      });
    });
  }

  async probe(url: string, opts: YtDlpRequestOpts, signal?: AbortSignal): Promise<ProbeResult> {
    const out = await this.run(['-J', ...this.commonArgs(opts), url], {
      timeoutMs: PROBE_TIMEOUT_MS,
      signal,
    });
    let info: Record<string, unknown>;
    try {
      info = JSON.parse(out) as Record<string, unknown>;
    } catch {
      throw new Error('yt-dlp 元数据解析失败');
    }
    return {
      id: String(info['id'] ?? ''),
      title: String(info['title'] ?? ''),
      webpageUrl: String(info['webpage_url'] ?? url),
      durationMs: typeof info['duration'] === 'number' ? Math.round(info['duration'] * 1000) : null,
      width: typeof info['width'] === 'number' ? info['width'] : null,
      height: typeof info['height'] === 'number' ? info['height'] : null,
      thumbnailUrl: typeof info['thumbnail'] === 'string' ? info['thumbnail'] : null,
      filesizeApprox:
        typeof info['filesize_approx'] === 'number' ? info['filesize_approx'] : null,
      progressive: pickProgressive(info),
    };
  }

  /** 搜索目标（ytsearchN: 前缀或搜索结果页 URL）的扁平条目列表 */
  async searchFlatPlaylist(
    target: string,
    limit: number,
    opts: YtDlpRequestOpts,
    signal?: AbortSignal,
  ): Promise<FlatEntry[]> {
    // 搜索目标本身就是 playlist，这里不能带 --no-playlist
    const args = ['-J', '--flat-playlist', '--playlist-items', `1:${limit}`, '--no-warnings'];
    if (opts.proxy) args.push('--proxy', opts.proxy);
    if (opts.cookie) args.push('--add-header', `Cookie: ${opts.cookie}`);
    const out = await this.run([...args, target], { timeoutMs: SEARCH_TIMEOUT_MS, signal });
    let info: { entries?: Record<string, unknown>[] };
    try {
      info = JSON.parse(out) as { entries?: Record<string, unknown>[] };
    } catch {
      throw new Error('yt-dlp 搜索结果解析失败');
    }
    return (info.entries ?? [])
      .filter((e) => typeof e['url'] === 'string' || typeof e['webpage_url'] === 'string')
      .map((e) => ({
        url: String(e['webpage_url'] ?? e['url']),
        title: String(e['title'] ?? ''),
        durationMs: typeof e['duration'] === 'number' ? Math.round(e['duration'] * 1000) : null,
        thumbnailUrl: flatThumbnail(e),
        uploader: typeof e['uploader'] === 'string' ? e['uploader'] : null,
      }));
  }

  /**
   * 下载视频到 outDir（输出文件名固定 video.<ext>，合并封装为 mp4）。
   * --max-filesize 命中时 yt-dlp 跳过且退出码为 0——以输出文件是否存在判定。
   */
  async download(
    url: string,
    opts: { maxHeight: number; maxBytes: number; outDir: string } & YtDlpRequestOpts,
    onProgress: (pct: number, totalBytes: number | null) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult> {
    fs.mkdirSync(opts.outDir, { recursive: true });
    const h = opts.maxHeight;
    const format = `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}][ext=mp4]/bv*[height<=${h}]+ba/b`;
    const args = [
      '-f',
      format,
      '--merge-output-format',
      'mp4',
      '--max-filesize',
      String(opts.maxBytes),
      '--newline',
      '--no-mtime',
      ...this.commonArgs(opts),
      '-o',
      path.join(opts.outDir, 'video.%(ext)s'),
      url,
    ];
    let sawMaxFilesizeSkip = false;
    await this.run(args, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      signal,
      onStdoutLine: (line) => {
        if (line.includes('max-filesize')) sawMaxFilesizeSkip = true;
        const m = PROGRESS_RE.exec(line);
        if (m && m[1]) {
          onProgress(Number(m[1]), m[2] && m[3] ? toBytes(m[2], m[3]) : null);
        }
      },
    });
    const filePath = path.join(opts.outDir, 'video.mp4');
    if (!fs.existsSync(filePath)) {
      // 合并失败时可能留下其他扩展名，兜底找 outDir 里最大的文件
      const files = fs
        .readdirSync(opts.outDir)
        .map((f) => path.join(opts.outDir, f))
        .filter((f) => fs.statSync(f).isFile() && !f.endsWith('.part'));
      const biggest = files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
      if (!biggest) {
        throw new Error(sawMaxFilesizeSkip ? 'max-filesize：视频超出体积上限' : '下载未产出文件');
      }
      return { filePath: biggest, sizeBytes: fs.statSync(biggest).size };
    }
    return { filePath, sizeBytes: fs.statSync(filePath).size };
  }
}

/** 从 -J 的 formats 里挑最优"单文件渐进式 mp4"（D 期流式引用用） */
function pickProgressive(info: Record<string, unknown>): ProgressiveFormat | null {
  const formats = Array.isArray(info['formats']) ? (info['formats'] as Record<string, unknown>[]) : [];
  const candidates = formats.filter((f) => {
    const proto = String(f['protocol'] ?? '');
    return (
      f['vcodec'] !== 'none' &&
      f['acodec'] !== 'none' &&
      typeof f['url'] === 'string' &&
      (proto === 'https' || proto === 'http') &&
      String(f['ext'] ?? '') === 'mp4'
    );
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Number(b['height'] ?? 0) - Number(a['height'] ?? 0));
  const best = candidates[0]!;
  return {
    url: String(best['url']),
    httpHeaders:
      typeof best['http_headers'] === 'object' && best['http_headers'] !== null
        ? (best['http_headers'] as Record<string, string>)
        : {},
    width: typeof best['width'] === 'number' ? best['width'] : null,
    height: typeof best['height'] === 'number' ? best['height'] : null,
  };
}

function flatThumbnail(e: Record<string, unknown>): string | null {
  if (typeof e['thumbnail'] === 'string') return e['thumbnail'];
  const thumbs = e['thumbnails'];
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    const last = thumbs[thumbs.length - 1] as Record<string, unknown>;
    if (typeof last['url'] === 'string') return last['url'];
  }
  return null;
}
