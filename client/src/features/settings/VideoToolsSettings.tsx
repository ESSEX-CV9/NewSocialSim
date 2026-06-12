import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type PixivLoginStatus, type ToolId, type ToolStatus } from '../../api/endpoints';
import { useI18n } from '../../i18n/I18nContext';
import { inputClass } from '../auth/LoginPage';

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 工具行：状态灯 + 版本信息 + 安装/更新按钮 + 下载详情（文件/来源/速度/进度） */
function ToolRow({
  tool,
  latest,
  installing,
  onInstall,
}: {
  tool: ToolStatus;
  latest: string | null;
  installing: boolean;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const job = tool.job;
  const running = job !== null && (job.state === 'downloading' || job.state === 'extracting');
  const updateAvailable =
    tool.installed && latest !== null && tool.version !== null && tool.version !== latest;
  const knownTotal = (job?.totalBytes ?? null) !== null && (job?.totalBytes ?? 0) > 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-x-border p-3">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${tool.installed ? 'bg-x-green' : 'bg-x-dim'}`} />
        <span className="text-[15px] font-bold">{tool.id}</span>
        <span className="text-[13px] text-x-dim">
          {tool.installed
            ? `${t('videoTools.installedVersion')} ${tool.version ?? '?'}`
            : t('videoTools.notInstalled')}
          {latest && `（${t('videoTools.latestVersion')} ${latest}）`}
        </span>
        {updateAvailable && (
          <span className="rounded-full bg-x-blue/15 px-2 py-0.5 text-[12px] text-x-blue">
            {t('videoTools.updateAvailable')}
          </span>
        )}
        <button
          onClick={onInstall}
          disabled={running || installing}
          className="ml-auto rounded-full bg-x-blue px-4 py-1.5 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
        >
          {tool.installed ? t('videoTools.update') : t('videoTools.install')}
        </button>
      </div>
      {running && job && (
        <div className="flex flex-col gap-1">
          {/* 在下载什么、从哪下：始终带旋转动画，避免看起来卡死 */}
          <div className="flex items-center gap-2 text-[12px] text-x-dim">
            <i className="ri-loader-4-line shrink-0 animate-spin text-[14px] text-x-blue" />
            <span className="truncate">
              {job.state === 'extracting'
                ? t('videoTools.extracting')
                : `${t('videoTools.downloading')} ${job.file ?? ''} — ${hostOf(job.url)}`}
            </span>
          </div>
          {job.state === 'downloading' && (
            <>
              <div className="h-1 w-full overflow-hidden rounded-full bg-x-input">
                {knownTotal ? (
                  <div
                    className="h-full bg-x-blue transition-all duration-300"
                    style={{ width: `${job.progress}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 animate-pulse bg-x-blue" />
                )}
              </div>
              <div className="flex justify-between text-[12px] text-x-dim">
                <span>
                  {fmtBytes(job.downloadedBytes ?? 0)}
                  {knownTotal && ` / ${fmtBytes(job.totalBytes!)}`}
                  {knownTotal && `（${job.progress}%）`}
                </span>
                <span>{job.speedBps !== undefined ? `${fmtBytes(job.speedBps)}/s` : t('videoTools.connecting')}</span>
              </div>
            </>
          )}
        </div>
      )}
      {job?.state === 'error' && (
        <div className="text-[13px] text-x-red">
          {t('videoTools.installFailed')}：{job.message ?? ''}
        </div>
      )}
    </div>
  );
}

/** 设置页"视频工具"区块：yt-dlp / ffmpeg 一键安装与更新（视频搜索与引入的前置依赖） */
export function VideoToolsSettings() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [ytdlpUrl, setYtdlpUrl] = useState<string | null>(null);
  const [ffmpegUrl, setFfmpegUrl] = useState<string | null>(null);
  const [mirrorMsg, setMirrorMsg] = useState<string | null>(null);
  const [biliCookies, setBiliCookies] = useState('');
  const [biliMsg, setBiliMsg] = useState<string | null>(null);
  const [biliManualOpen, setBiliManualOpen] = useState(false);
  const [biliLogin, setBiliLoginState] = useState<PixivLoginStatus | null>(null);
  const biliPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopBiliPolling = () => {
    if (biliPollTimer.current) {
      clearInterval(biliPollTimer.current);
      biliPollTimer.current = null;
    }
  };
  useEffect(() => stopBiliPolling, []);

  const startBiliLogin = async () => {
    const status = await api.biliLogin();
    setBiliLoginState(status);
    stopBiliPolling();
    biliPollTimer.current = setInterval(() => {
      void api.biliLoginStatus().then((s) => {
        setBiliLoginState(s);
        if (s.state === 'success' || s.state === 'error') {
          stopBiliPolling();
          if (s.state === 'success') {
            void queryClient.invalidateQueries({ queryKey: ['media-search-config'] });
          }
        }
      });
    }, 2000);
  };

  const status = useQuery({
    queryKey: ['tools-status'],
    queryFn: api.toolsStatus,
    // 有安装任务在跑时 1 秒轮询刷进度，否则不轮询
    refetchInterval: (query) =>
      (query.state.data?.tools ?? []).some(
        (tl) => tl.job && (tl.job.state === 'downloading' || tl.job.state === 'extracting'),
      )
        ? 1000
        : false,
  });
  const latest = useQuery({ queryKey: ['tools-latest'], queryFn: api.toolsLatest });
  const config = useQuery({ queryKey: ['media-search-config'], queryFn: api.mediaSearchConfig });

  const tools = status.data?.tools ?? [];
  const byId = (id: ToolId) => tools.find((tl) => tl.id === id);

  const install = async (id: ToolId) => {
    setInstalling(true);
    setInstallError(null);
    try {
      await api.toolInstall(id);
      await queryClient.invalidateQueries({ queryKey: ['tools-status'] });
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  const saveMirrors = async () => {
    setMirrorMsg(null);
    try {
      await api.patchMediaSearchConfig({
        tools: {
          ...(ytdlpUrl !== null ? { ytdlpUrl: ytdlpUrl.trim() } : {}),
          ...(ffmpegUrl !== null ? { ffmpegUrl: ffmpegUrl.trim() } : {}),
        },
      });
      setMirrorMsg(t('mediaSearch.saved'));
      void queryClient.invalidateQueries({ queryKey: ['media-search-config'] });
      void queryClient.invalidateQueries({ queryKey: ['tools-status'] });
    } catch (e) {
      setMirrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const saveBiliCookies = async () => {
    if (!biliCookies.trim()) return;
    setBiliMsg(null);
    try {
      await api.patchMediaSearchConfig({ bilibili: { cookies: biliCookies.trim() } });
      setBiliCookies('');
      setBiliMsg(t('mediaSearch.saved'));
      void queryClient.invalidateQueries({ queryKey: ['media-search-config'] });
    } catch (e) {
      setBiliMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="border-b border-x-border p-4">
      <h2 className="mb-1 text-xl font-extrabold">{t('videoTools.settingsTitle')}</h2>
      <p className="mb-3 text-[13px] text-x-dim">{t('videoTools.intro')}</p>
      <div className="flex flex-col gap-2">
        {tools.map((tool) => (
          <ToolRow
            key={tool.id}
            tool={tool}
            latest={tool.id === 'yt-dlp' ? (latest.data?.latest.ytdlp ?? null) : null}
            installing={installing}
            onInstall={() => void install(tool.id)}
          />
        ))}
      </div>
      {installError && <div className="mt-2 text-[13px] text-x-red">{installError}</div>}

      {/* 镜像源：GitHub 直连/代理慢时可替换下载地址 */}
      <h3 className="mt-6 mb-2 text-[15px] font-bold text-x-dim">{t('videoTools.mirrorTitle')}</h3>
      <p className="mb-2 text-[13px] text-x-dim">{t('videoTools.mirrorHint')}</p>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-x-dim">
          {t('videoTools.mirrorYtdlp')}
          <input
            value={ytdlpUrl ?? config.data?.config.toolsYtdlpUrl ?? ''}
            onChange={(e) => setYtdlpUrl(e.target.value)}
            placeholder={byId('yt-dlp')?.defaultUrl ?? ''}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-x-dim">
          {t('videoTools.mirrorFfmpeg')}
          <input
            value={ffmpegUrl ?? config.data?.config.toolsFfmpegUrl ?? ''}
            onChange={(e) => setFfmpegUrl(e.target.value)}
            placeholder={byId('ffmpeg')?.defaultUrl ?? ''}
            className={inputClass}
          />
        </label>
        <div className="flex items-center gap-3 self-end">
          {mirrorMsg && <span className="text-[13px] text-x-dim">{mirrorMsg}</span>}
          <button
            onClick={() => void saveMirrors()}
            disabled={ytdlpUrl === null && ffmpegUrl === null}
            className="rounded-full bg-x-blue px-4 py-1.5 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </div>

      {/* B站登录：api.bilibili.com 对无 Cookie 请求 412 风控；引导登录自动捕获（Pixiv 同范式） */}
      <h3 className="mt-6 mb-2 text-[15px] font-bold text-x-dim">{t('videoTools.biliTitle')}</h3>
      <p className="mb-2 text-[13px] text-x-dim">{t('videoTools.biliHint')}</p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void startBiliLogin()}
            disabled={biliLogin?.state === 'waiting' || biliLogin?.state === 'exchanging'}
            className="rounded-full bg-x-blue px-4 py-1.5 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
          >
            {config.data?.config.bilibiliHasCookies
              ? t('videoTools.biliRelogin')
              : t('videoTools.biliLogin')}
          </button>
          {config.data?.config.bilibiliHasCookies && (
            <span className="text-[13px] text-x-green">
              <i className="ri-checkbox-circle-fill mr-1" />
              {t('mediaSearch.configured')}
            </span>
          )}
        </div>
        {biliLogin && biliLogin.state !== 'idle' && (
          <div className="text-[13px] text-x-dim">
            {biliLogin.state === 'waiting' || biliLogin.state === 'launching'
              ? t('videoTools.biliLoginWaiting')
              : biliLogin.state === 'exchanging'
                ? t('videoTools.biliLoginSaving')
                : biliLogin.state === 'success'
                  ? t('videoTools.biliLoginSuccess')
                  : `${t('videoTools.biliLoginFailed')}：${biliLogin.message ?? ''}`}
          </div>
        )}
        {/* 手动粘贴兜底（引导失败/无浏览器时） */}
        <button
          onClick={() => setBiliManualOpen((v) => !v)}
          className="self-start text-[13px] text-x-dim hover:text-x-blue hover:underline"
        >
          {t('videoTools.biliManualToggle')}
        </button>
        {biliManualOpen && (
          <>
            <textarea
              value={biliCookies}
              onChange={(e) => setBiliCookies(e.target.value)}
              placeholder="buvid3=...; SESSDATA=...; bili_jct=..."
              rows={2}
              className={inputClass}
            />
            <div className="flex items-center gap-3 self-end">
              {biliMsg && <span className="text-[13px] text-x-dim">{biliMsg}</span>}
              <button
                onClick={() => void saveBiliCookies()}
                disabled={!biliCookies.trim()}
                className="rounded-full bg-x-blue px-4 py-1.5 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
              >
                {t('common.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
