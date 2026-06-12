import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type ToolId, type ToolStatus } from '../../api/endpoints';
import { useI18n } from '../../i18n/I18nContext';

/** 工具行：状态灯 + 版本信息 + 安装/更新按钮 + 安装进度条 */
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
      {running && (
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-x-input">
            <div
              className="h-full bg-x-blue transition-all duration-300"
              style={{ width: `${job.progress}%` }}
            />
          </div>
          <span className="w-24 text-right text-[12px] text-x-dim">
            {job.state === 'extracting' ? t('videoTools.extracting') : `${job.progress}%`}
          </span>
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

  const install = async (id: ToolId) => {
    setInstalling(true);
    try {
      await api.toolInstall(id);
      await queryClient.invalidateQueries({ queryKey: ['tools-status'] });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section className="border-b border-x-border p-4">
      <h2 className="mb-1 text-xl font-extrabold">{t('videoTools.settingsTitle')}</h2>
      <p className="mb-3 text-[13px] text-x-dim">{t('videoTools.intro')}</p>
      <div className="flex flex-col gap-2">
        {(status.data?.tools ?? []).map((tool) => (
          <ToolRow
            key={tool.id}
            tool={tool}
            latest={tool.id === 'yt-dlp' ? (latest.data?.latest.ytdlp ?? null) : null}
            installing={installing}
            onInstall={() => void install(tool.id)}
          />
        ))}
      </div>
    </section>
  );
}
