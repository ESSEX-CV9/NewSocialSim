import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { ValidationError } from '../../core/errors/app-error.js';
import { downloadToFile, expandZip, findFileIn, rmWithRetry } from './bin-installer.js';

/**
 * 视频工具二进制管理（yt-dlp / ffmpeg）：状态查询、设置页一键安装与更新。
 * 实例级基础设施（data/bin/，与世界无关）——时间使用真实墙钟属设计豁免。
 */

export type ToolId = 'yt-dlp' | 'ffmpeg';
export const TOOL_IDS: readonly ToolId[] = ['yt-dlp', 'ffmpeg'];

export interface InstallJobView {
  state: 'downloading' | 'extracting' | 'done' | 'error';
  /** 0-100 */
  progress: number;
  message?: string;
}

export interface ToolStatus {
  id: ToolId;
  installed: boolean;
  version: string | null;
  path: string | null;
  job: InstallJobView | null;
}

/** releases/latest/download 形式免 GitHub API（不受速率限制） */
const YTDLP_EXE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_ZIP_URL =
  'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';
const YTDLP_LATEST_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const LATEST_CACHE_MS = 10 * 60 * 1000;
const VERSION_TIMEOUT_MS = 10_000;

function execVersion(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err) resolve(null);
        else resolve(stdout.split(/\r?\n/)[0]?.trim() || null);
      },
    );
  });
}

export class ToolsService {
  private readonly jobs = new Map<ToolId, InstallJobView>();
  /** --version 结果缓存（spawn 有开销）；安装成功后失效 */
  private readonly versionCache = new Map<ToolId, string | null>();
  private latestCache: { ytdlp: string | null; at: number } | null = null;
  /** 周期 C 起由 video-search 注入：有运行中的视频任务时拒绝覆盖二进制（Windows 文件锁） */
  private busyCheck: () => boolean = () => false;

  setBusyCheck(fn: () => boolean): void {
    this.busyCheck = fn;
  }

  /** yt-dlp.exe 绝对路径；未安装为 null（video-search 据此报源不可用） */
  ytdlpPath(): string | null {
    const p = path.join(config.binDir, 'yt-dlp.exe');
    return fs.existsSync(p) ? p : null;
  }

  /** ffmpeg 所在目录（传给 yt-dlp --ffmpeg-location）；未安装为 null */
  ffmpegDir(): string | null {
    const dir = path.join(config.binDir, 'ffmpeg');
    return fs.existsSync(path.join(dir, 'ffmpeg.exe')) ? dir : null;
  }

  async status(): Promise<ToolStatus[]> {
    return Promise.all(TOOL_IDS.map((id) => this.statusOf(id)));
  }

  private async statusOf(id: ToolId): Promise<ToolStatus> {
    const toolPath = id === 'yt-dlp' ? this.ytdlpPath() : this.exePathOfFfmpeg();
    return {
      id,
      installed: toolPath !== null,
      version: toolPath ? await this.version(id, toolPath) : null,
      path: toolPath,
      job: this.jobs.get(id) ?? null,
    };
  }

  private exePathOfFfmpeg(): string | null {
    const dir = this.ffmpegDir();
    return dir ? path.join(dir, 'ffmpeg.exe') : null;
  }

  private async version(id: ToolId, toolPath: string): Promise<string | null> {
    if (this.versionCache.has(id)) return this.versionCache.get(id) ?? null;
    let v: string | null;
    if (id === 'yt-dlp') {
      v = await execVersion(toolPath, ['--version']);
    } else {
      const line = await execVersion(toolPath, ['-version']);
      v = line ? (/ffmpeg version (\S+)/.exec(line)?.[1] ?? line) : null;
    }
    this.versionCache.set(id, v);
    return v;
  }

  /** yt-dlp 最新版本号（GitHub API，10 分钟缓存）；ffmpeg 为滚动构建无版本概念 */
  async latestVersions(): Promise<{ ytdlp: string | null; ffmpeg: string | null }> {
    if (this.latestCache && Date.now() - this.latestCache.at < LATEST_CACHE_MS) {
      return { ytdlp: this.latestCache.ytdlp, ffmpeg: null };
    }
    let tag: string | null = null;
    try {
      const res = await fetch(YTDLP_LATEST_API, {
        headers: { 'user-agent': 'NewSocialSim-tools', accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { tag_name?: string };
        tag = body.tag_name ?? null;
      }
    } catch {
      tag = null;
    }
    this.latestCache = { ytdlp: tag, at: Date.now() };
    return { ytdlp: tag, ffmpeg: null };
  }

  startInstall(id: ToolId): InstallJobView {
    const running = this.jobs.get(id);
    if (running && running.state !== 'done' && running.state !== 'error') {
      throw new ValidationError('该工具正在安装中');
    }
    if (this.busyCheck()) {
      throw new ValidationError('有视频任务正在运行，请稍后再安装/更新工具');
    }
    const job: InstallJobView = { state: 'downloading', progress: 0 };
    this.jobs.set(id, job);
    void this.runInstall(id, job);
    return job;
  }

  installStatus(id: ToolId): InstallJobView | null {
    return this.jobs.get(id) ?? null;
  }

  private async runInstall(id: ToolId, job: InstallJobView): Promise<void> {
    const tmpDir = path.join(config.binDir, 'tmp');
    try {
      await rmWithRetry(tmpDir);
      fs.mkdirSync(tmpDir, { recursive: true });
      if (id === 'yt-dlp') {
        const tmpFile = path.join(tmpDir, 'yt-dlp.exe.new');
        await downloadToFile(YTDLP_EXE_URL, tmpFile, (done, total) => {
          job.progress = total ? Math.min(99, Math.round((done / total) * 100)) : 0;
        });
        // renameSync 在 Windows 上可覆盖既有文件（MOVEFILE_REPLACE_EXISTING）
        fs.renameSync(tmpFile, path.join(config.binDir, 'yt-dlp.exe'));
      } else {
        const zipFile = path.join(tmpDir, 'ffmpeg.zip');
        await downloadToFile(FFMPEG_ZIP_URL, zipFile, (done, total) => {
          job.progress = total ? Math.min(80, Math.round((done / total) * 80)) : 0;
        });
        job.state = 'extracting';
        job.progress = 80;
        const extractDir = path.join(tmpDir, 'extract');
        await expandZip(zipFile, extractDir);
        job.progress = 95;
        const ffmpegExe = findFileIn(extractDir, 'ffmpeg.exe');
        const ffprobeExe = findFileIn(extractDir, 'ffprobe.exe');
        if (!ffmpegExe || !ffprobeExe) throw new Error('压缩包内未找到 ffmpeg.exe/ffprobe.exe');
        const destDir = path.join(config.binDir, 'ffmpeg');
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(ffmpegExe, path.join(destDir, 'ffmpeg.exe'));
        fs.copyFileSync(ffprobeExe, path.join(destDir, 'ffprobe.exe'));
      }
      this.versionCache.delete(id);
      job.state = 'done';
      job.progress = 100;
    } catch (err) {
      job.state = 'error';
      job.message = err instanceof Error ? err.message : String(err);
    } finally {
      await rmWithRetry(tmpDir);
    }
  }
}
