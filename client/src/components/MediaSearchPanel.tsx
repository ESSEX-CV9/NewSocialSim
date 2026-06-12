import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type MediaSearchResult } from '../api/endpoints';
import { useI18n } from '../i18n/I18nContext';
import { useWorld } from '../world/WorldContext';

type Rating = 'safe' | 'all' | 'r18';

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
  disabled,
}: {
  /** 选图入库成功后回调（计入挂帖名额由 Composer 把关） */
  onPicked: (mediaId: { id: number; type: 'image' | 'video'; url: string; width: number | null; height: number | null }) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { world } = useWorld();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  // 分级默认取世界设定，单次搜索可随时改
  const [rating, setRating] = useState<Rating>(world?.meta.contentRating ?? 'safe');
  const [submitted, setSubmitted] = useState<{ q: string; source: string; rating: Rating } | null>(
    null,
  );
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sources = useQuery({ queryKey: ['media-search-sources'], queryFn: api.mediaSearchSources });
  const results = useQuery({
    queryKey: ['media-search', submitted?.q, submitted?.source, submitted?.rating],
    queryFn: () => api.mediaSearch(submitted!.q, submitted!.source || undefined, submitted!.rating),
    enabled: submitted !== null,
    staleTime: 5 * 60 * 1000,
  });

  const submit = () => {
    const q = query.trim();
    if (q) setSubmitted({ q, source, rating });
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

  return (
    <div className="mb-2 rounded-2xl border border-x-border p-3">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('mediaSearch.queryPrompt')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          className="min-w-0 flex-1 rounded-full border border-x-border bg-transparent px-4 py-1.5 text-[14px] outline-none placeholder:text-x-dim focus:border-x-blue"
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded-full border border-x-border bg-x-bg px-3 py-1.5 text-[13px] outline-none"
        >
          <option value="">{t('mediaSearch.sourceAll')}</option>
          {(sources.data?.sources ?? []).map((s) => (
            <option key={s.id} value={s.id} disabled={!s.ok}>
              {s.id}
              {s.ok ? '' : ` (${t('mediaSearch.sourceNeedsConfig')})`}
            </option>
          ))}
        </select>
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
        <button
          onClick={submit}
          disabled={query.trim().length === 0 || results.isFetching}
          className="rounded-full bg-x-blue px-4 py-1.5 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
        >
          {results.isFetching ? (
            <i className="ri-loader-4-line animate-spin" />
          ) : (
            t('mediaSearch.search')
          )}
        </button>
      </div>

      {error && <div className="mt-2 text-sm text-x-red">{error}</div>}

      {submitted && results.isSuccess && results.data.results.length === 0 && (
        <div className="mt-3 text-center text-[14px] text-x-dim">{t('mediaSearch.noResults')}</div>
      )}

      {results.isSuccess && results.data.results.length > 0 && (
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
    </div>
  );
}
