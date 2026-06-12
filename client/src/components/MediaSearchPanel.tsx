import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type MediaSearchResult, type VideoSearchResult } from '../api/endpoints';
import { useI18n } from '../i18n/I18nContext';
import { useWorld } from '../world/WorldContext';

type Rating = 'safe' | 'all' | 'r18';
type Dimension = 'image' | 'video';
type IngestMode = 'auto' | 'download' | 'stream';

/** 毫秒 → mm:ss / h:mm:ss */
function fmtDuration(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** 需要 Referer 的站点经服务端代理显示预览 */
function previewSrc(item: MediaSearchResult): string {
  if (item.referer) {
    return `/api/media-search/preview?url=${encodeURIComponent(item.preview)}`;
  }
  return item.preview;
}

/** 发帖框内的关键字搜图面板：搜索 → 点选 → 经 from-url 下载入库挂帖 */
export function MediaSearchPanel({
  onPicked,
  onVideoTask,
  disabled,
}: {
  /** 选图入库成功后回调（计入挂帖名额由 Composer 把关） */
  onPicked: (mediaId: { id: number; type: 'image' | 'video'; url: string; width: number | null; height: number | null }) => void;
  /** 选视频候选后创建了引入任务（task）或命中嵌入卡（embed），由 Composer 接管 */
  onVideoTask: (result: { taskId?: string; embedUrl?: string }) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { world } = useWorld();
  const [dimension, setDimension] = useState<Dimension>('image');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [videoSource, setVideoSource] = useState('');
  const [videoMode, setVideoMode] = useState<IngestMode>('auto');
  // 分级默认取世界设定，单次搜索可随时改
  const [rating, setRating] = useState<Rating>(world?.meta.contentRating ?? 'safe');
  const [submitted, setSubmitted] = useState<{ q: string; source: string; rating: Rating } | null>(
    null,
  );
  const [videoSubmitted, setVideoSubmitted] = useState<{ q: string; source: string } | null>(null);
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sources = useQuery({ queryKey: ['media-search-sources'], queryFn: api.mediaSearchSources });
  const results = useQuery({
    queryKey: ['media-search', submitted?.q, submitted?.source, submitted?.rating],
    queryFn: () => api.mediaSearch(submitted!.q, submitted!.source || undefined, submitted!.rating),
    enabled: submitted !== null,
    staleTime: 5 * 60 * 1000,
  });
  const videoSources = useQuery({ queryKey: ['video-sources'], queryFn: api.videoSources });
  const videoResults = useQuery({
    queryKey: ['video-search', videoSubmitted?.q, videoSubmitted?.source],
    queryFn: () => api.videoSearch(videoSubmitted!.q, videoSubmitted!.source || undefined),
    enabled: videoSubmitted !== null,
    staleTime: 5 * 60 * 1000,
  });

  // 分级下拉只在所选源支持分级时显示（"全部源"时只要有任一可用源支持即显示）
  const sourceList = sources.data?.sources ?? [];
  const ratingVisible = source
    ? (sourceList.find((s) => s.id === source)?.supportsRating ?? false)
    : sourceList.some((s) => s.ok && s.supportsRating);
  const videoSourceList = videoSources.data?.sources ?? [];

  const isVideo = dimension === 'video';
  const fetching = isVideo ? videoResults.isFetching : results.isFetching;

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    if (isVideo) setVideoSubmitted({ q, source: videoSource });
    else setSubmitted({ q, source, rating });
  };

  const pick = async (item: MediaSearchResult) => {
    if (disabled || ingesting) return;
    setIngesting(item.url);
    setError(null);
    try {
      const res = await api.mediaFromUrl(item.url, `search:${item.source}`);
      onPicked(res.media);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIngesting(null);
    }
  };

  const pickVideo = async (item: VideoSearchResult) => {
    if (disabled || ingesting) return;
    setIngesting(item.url);
    setError(null);
    try {
      const res = await api.videoIngest(item.url, videoMode);
      if (res.embed) onVideoTask({ embedUrl: item.url });
      else if (res.task) onVideoTask({ taskId: res.task.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIngesting(null);
    }
  };

  const reasonText = (reason?: string): string =>
    reason === 'world-rating'
      ? t('videoSearch.reasonRating')
      : reason === 'no-ytdlp'
        ? t('videoSearch.reasonNoTool')
        : t('mediaSearch.sourceNeedsConfig');

  return (
    <div className="mb-2 rounded-2xl border border-x-border p-3">
      {/* 维度切换：图片 / 视频 */}
      <div className="mb-2 flex gap-1">
        {(['image', 'video'] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDimension(d)}
            className={`rounded-full px-3 py-1 text-[13px] font-bold transition-colors duration-200 ${
              dimension === d ? 'bg-x-blue text-white' : 'text-x-dim hover:bg-x-hover'
            }`}
          >
            {t(d === 'image' ? 'mediaSearch.tabImage' : 'mediaSearch.tabVideo')}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(isVideo ? 'videoSearch.queryPrompt' : 'mediaSearch.queryPrompt')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          className="min-w-0 flex-1 rounded-full border border-x-border bg-transparent px-4 py-1.5 text-[14px] outline-none placeholder:text-x-dim focus:border-x-blue"
        />
        {isVideo ? (
          <>
            <select
              value={videoSource}
              onChange={(e) => setVideoSource(e.target.value)}
              className="rounded-full border border-x-border bg-x-bg px-3 py-1.5 text-[13px] outline-none"
            >
              <option value="">{t('mediaSearch.sourceAll')}</option>
              {videoSourceList.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.ok}>
                  {s.id}
                  {s.ok ? '' : ` (${reasonText(s.reason)})`}
                </option>
              ))}
            </select>
            <select
              value={videoMode}
              onChange={(e) => setVideoMode(e.target.value as IngestMode)}
              title={t('videoSearch.mode')}
              className="rounded-full border border-x-border bg-x-bg px-3 py-1.5 text-[13px] outline-none"
            >
              <option value="auto">{t('composer.videoModeAuto')}</option>
              <option value="download">{t('composer.videoModeDownload')}</option>
              <option value="stream">{t('composer.videoModeStream')}</option>
            </select>
          </>
        ) : (
          <>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="rounded-full border border-x-border bg-x-bg px-3 py-1.5 text-[13px] outline-none"
            >
              <option value="">{t('mediaSearch.sourceAll')}</option>
              {sourceList.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.ok}>
                  {s.id}
                  {s.ok ? '' : ` (${t('mediaSearch.sourceNeedsConfig')})`}
                </option>
              ))}
            </select>
            {ratingVisible && (
              <select
                value={rating}
                onChange={(e) => setRating(e.target.value as Rating)}
                title={t('mediaSearch.rating')}
                className="rounded-full border border-x-border bg-x-bg px-3 py-1.5 text-[13px] outline-none"
              >
                <option value="safe">{t('mediaSearch.ratingSafe')}</option>
                <option value="all">{t('mediaSearch.ratingAll')}</option>
                <option value="r18">{t('mediaSearch.ratingR18')}</option>
              </select>
            )}
          </>
        )}
        <button
          onClick={submit}
          disabled={query.trim().length === 0 || fetching}
          className="rounded-full bg-x-blue px-4 py-1.5 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
        >
          {fetching ? <i className="ri-loader-4-line animate-spin" /> : t('mediaSearch.search')}
        </button>
      </div>

      {error && <div className="mt-2 text-sm text-x-red">{error}</div>}

      {/* 图片结果 */}
      {!isVideo && submitted && results.isSuccess && results.data.results.length === 0 && (
        <div className="mt-3 text-center text-[14px] text-x-dim">{t('mediaSearch.noResults')}</div>
      )}
      {!isVideo && results.isSuccess && results.data.results.length > 0 && (
        <div className="mt-3 grid max-h-80 grid-cols-4 gap-1.5 overflow-y-auto">
          {results.data.results.map((item) => (
            <button
              key={`${item.source}-${item.url}`}
              onClick={() => void pick(item)}
              disabled={disabled || ingesting !== null}
              title={`[${item.source}] ${item.title}`}
              className="group relative aspect-square overflow-hidden rounded-lg bg-x-input disabled:opacity-60"
            >
              <img
                src={previewSrc(item)}
                alt={item.title}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
              />
              {ingesting === item.url && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                  <i className="ri-loader-4-line animate-spin text-[20px]" />
                </span>
              )}
              <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] text-white">
                {item.source}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 视频结果：16:9 卡 + 时长徽标 + 来源角标 */}
      {isVideo && videoSubmitted && videoResults.isSuccess && videoResults.data.results.length === 0 && (
        <div className="mt-3 text-center text-[14px] text-x-dim">{t('mediaSearch.noResults')}</div>
      )}
      {isVideo && videoResults.isSuccess && videoResults.data.results.length > 0 && (
        <div className="mt-3 grid max-h-80 grid-cols-3 gap-1.5 overflow-y-auto">
          {videoResults.data.results.map((item) => (
            <button
              key={`${item.source}-${item.url}`}
              onClick={() => void pickVideo(item)}
              disabled={disabled || ingesting !== null}
              title={`[${item.source}] ${item.title}`}
              className="group relative aspect-video overflow-hidden rounded-lg bg-x-input disabled:opacity-60"
            >
              {item.thumbnail ? (
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-x-dim">
                  <i className="ri-video-line text-[24px]" />
                </span>
              )}
              {ingesting === item.url && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                  <i className="ri-loader-4-line animate-spin text-[20px]" />
                </span>
              )}
              <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] text-white">
                {item.source}
              </span>
              {item.durationMs !== null && (
                <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] text-white">
                  {fmtDuration(item.durationMs)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
