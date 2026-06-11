import type { LinkCardView } from '@socialsim/shared';
import type { MouseEvent } from 'react';

/** X 式链接预览卡片：上图下文，点击新标签打开外链 */
export function LinkCard({ card }: { card: LinkCardView }) {
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    window.open(card.url, '_blank', 'noopener');
  };
  let host = '';
  try {
    host = new URL(card.url).hostname.replace(/^www\./, '');
  } catch {
    host = card.url;
  }

  return (
    <div
      onClick={open}
      className="mt-2 cursor-pointer overflow-hidden rounded-2xl border border-x-border transition-colors duration-200 hover:bg-x-hover"
    >
      {card.imageUrl && (
        <div className="max-h-72 w-full overflow-hidden border-b border-x-border">
          <img src={card.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        </div>
      )}
      <div className="px-3 py-2.5">
        <div className="text-[13px] text-x-dim">{card.siteName ?? host}</div>
        <div className="truncate text-[15px] text-x-text">{card.title}</div>
        {card.description && (
          <div className="line-clamp-2 text-[13px] text-x-dim">{card.description}</div>
        )}
      </div>
    </div>
  );
}
