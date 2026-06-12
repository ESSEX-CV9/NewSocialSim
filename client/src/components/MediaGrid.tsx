import type { MediaView } from '@socialsim/shared';
import { useRef, useState, type MouseEvent } from 'react';
import { MediaLightbox } from './MediaLightbox';

/** X 式媒体宫格：1=单图、2=两列、3=左一右二、4=2×2；点击开大图查看器；视频为内联播放器 */
export function MediaGrid({ media, compact }: { media: MediaView[]; compact?: boolean }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const inlineVideoRef = useRef<HTMLVideoElement>(null);
  if (media.length === 0) return null;

  // 视频与图片不混排（后端保证），有视频即单元素内联播放器
  if (media[0]!.type === 'video') {
    return (
      <div className="relative mt-2 overflow-hidden rounded-2xl border border-x-border">
        <video
          ref={inlineVideoRef}
          src={media[0]!.url}
          controls
          preload="metadata"
          onClick={(e) => e.stopPropagation()}
          className={`w-full bg-black ${compact ? 'max-h-72' : 'max-h-128'}`}
        />
        {/* 画面区域点击=放大查看（与图片一致），播放/暂停只走底部控制条；
            覆盖层底部留出原生控制条高度。查看器与原生全屏内保持默认点击行为 */}
        <div
          className="absolute inset-x-0 top-0 bottom-14 cursor-zoom-in"
          onClick={(e) => {
            e.stopPropagation();
            inlineVideoRef.current?.pause();
            setLightbox(0);
          }}
        />
        {lightbox !== null && (
          <MediaLightbox media={media} initialIndex={0} onClose={() => setLightbox(null)} />
        )}
      </div>
    );
  }

  const open = (e: MouseEvent, index: number) => {
    e.stopPropagation();
    setLightbox(index);
  };

  const img = (item: MediaView, index: number, className = '') => (
    <img
      key={item.id}
      src={item.url}
      alt=""
      onClick={(e) => open(e, index)}
      className={`h-full w-full cursor-zoom-in object-cover ${className}`}
      loading="lazy"
      draggable={false}
    />
  );

  const maxHeight = compact ? 'max-h-72' : 'max-h-128';
  let body;
  if (media.length === 1) {
    const m = media[0]!;
    // 单图按原始比例展示（限高），无比例信息退化为 16:9
    const ratio = m.width && m.height ? `${m.width} / ${m.height}` : '16 / 9';
    body = (
      <div className={`w-full ${maxHeight}`} style={{ aspectRatio: ratio }}>
        {img(m, 0)}
      </div>
    );
  } else if (media.length === 2) {
    body = (
      <div className="grid aspect-2/1 grid-cols-2 gap-0.5">
        {media.map((m, i) => img(m, i))}
      </div>
    );
  } else if (media.length === 3) {
    body = (
      <div className="grid aspect-2/1 grid-cols-2 gap-0.5">
        {img(media[0]!, 0)}
        <div className="grid grid-rows-2 gap-0.5">
          {img(media[1]!, 1)}
          {img(media[2]!, 2)}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="grid aspect-2/1 grid-cols-2 grid-rows-2 gap-0.5">
        {media.slice(0, 4).map((m, i) => img(m, i))}
      </div>
    );
  }

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-x-border">
      {body}
      {lightbox !== null && (
        <MediaLightbox media={media} initialIndex={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
