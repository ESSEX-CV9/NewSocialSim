import type { LinkCardView } from '@socialsim/shared';
import { useState } from 'react';
import type { MouseEvent } from 'react';
import { useI18n } from '../i18n/I18nContext';

/** 给 embed 地址追加 autoplay=1（B 站 embedUrl 自带 autoplay=0，用 URL API 覆盖而非拼接） */
function withAutoplay(embedUrl: string): string {
  try {
    const u = new URL(embedUrl);
    u.searchParams.set('autoplay', '1');
    return u.toString();
  } catch {
    return embedUrl;
  }
}

/**
 * X 式链接预览卡片：上图下文，点击新标签打开外链。
 * 可嵌入站点（embedUrl 非空）走"门面"模式：先显示缩略图+播放钮，点击才换入 iframe——
 * 滚动时间线不向第三方发任何请求，点击前零外联。
 */
export function LinkCard({ card }: { card: LinkCardView }) {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  let host = '';
  try {
    host = new URL(card.url).hostname.replace(/^www\./, '');
  } catch {
    host = card.url;
  }

  const openOriginal = (e: MouseEvent) => {
    e.stopPropagation();
    window.open(card.url, '_blank', 'noopener');
  };
  const onCardClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (card.embedUrl) setPlaying(true);
    else window.open(card.url, '_blank', 'noopener');
  };

  return (
    <div
      onClick={onCardClick}
      className="mt-2 cursor-pointer overflow-hidden rounded-2xl border border-x-border transition-colors duration-200 hover:bg-x-hover"
    >
      {card.embedUrl ? (
        playing ? (
          <div className="aspect-video w-full border-b border-x-border" onClick={(e) => e.stopPropagation()}>
            <iframe
              src={withAutoplay(card.embedUrl)}
              title={card.title}
              className="h-full w-full"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          <div className="relative aspect-video w-full overflow-hidden border-b border-x-border bg-x-input">
            {card.imageUrl && (
              <img src={card.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="flex size-14 items-center justify-center rounded-full bg-black/60 transition-colors duration-200 hover:bg-black/75"
                title={t('linkCard.play')}
              >
                <i className="ri-play-fill text-3xl text-white" />
              </div>
            </div>
          </div>
        )
      ) : (
        card.imageUrl && (
          <div className="max-h-72 w-full overflow-hidden border-b border-x-border">
            <img src={card.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          </div>
        )
      )}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1 text-[13px] text-x-dim">
          <span className="truncate">{card.siteName ?? host}</span>
          {card.embedUrl && (
            <button
              type="button"
              onClick={openOriginal}
              title={t('linkCard.openOriginal')}
              className="flex shrink-0 items-center text-x-dim transition-colors duration-200 hover:text-x-blue"
            >
              <i className="ri-external-link-line text-[14px]" />
            </button>
          )}
        </div>
        <div className="truncate text-[15px] text-x-text">{card.title}</div>
        {card.description && (
          <div className="line-clamp-2 text-[13px] text-x-dim">{card.description}</div>
        )}
      </div>
    </div>
  );
}
