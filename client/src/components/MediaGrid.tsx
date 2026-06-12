import type { MediaView } from '@socialsim/shared';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { MediaLightbox } from './MediaLightbox';
import { attachVideoPlayback, getVideoProgress } from './videoPlayback';

/** 内嵌视频：静音自动播放（50% 进视窗播、出视窗停、同屏只播最新），进度跨页记忆 */
function InlineVideo({
  media,
  compact,
  postId,
}: {
  media: MediaView;
  compact?: boolean | undefined;
  postId?: number | undefined;
}) {
  const [lightbox, setLightbox] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const detach = attachVideoPlayback(el, media.url);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // 静音起播以符合浏览器自动播放策略（X 同样静音起播）；用户解除静音后状态保留
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      detach();
    };
  }, [media.url]);

  return (
    <div className="relative mt-2 overflow-hidden rounded-2xl border border-x-border">
      <video
        ref={videoRef}
        src={media.url}
        controls
        muted
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
          videoRef.current?.pause();
          setLightbox(true);
        }}
      />
      {lightbox && (
        <MediaLightbox
          media={[media]}
          initialIndex={0}
          {...(postId !== undefined ? { postId } : {})}
          onClose={() => {
            setLightbox(false);
            // 从查看器回来：同步进度并继续内嵌播放
            const el = videoRef.current;
            if (el) {
              el.currentTime = getVideoProgress(media.url);
              void el.play().catch(() => {});
            }
          }}
        />
      )}
    </div>
  );
}

/** X 式媒体宫格：1=单图、2=两列、3=左一右二、4=2×2；点击开大图查看器；视频为内联播放器 */
export function MediaGrid({
  media,
  compact,
  postId,
}: {
  media: MediaView[];
  compact?: boolean;
  /** 来源帖子：传入后查看器带互动栏与详情面板 */
  postId?: number;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  if (media.length === 0) return null;

  // 单独 1 个视频走内联播放器；其余（含图视频混排）一律宫格 + 查看器
  if (media.length === 1 && media[0]!.type === 'video') {
    return <InlineVideo media={media[0]!} compact={compact} postId={postId} />;
  }

  const open = (e: MouseEvent, index: number) => {
    e.stopPropagation();
    setLightbox(index);
  };

  /** 宫格格子：图片直接展示；视频格为首帧 + 播放角标（不自动播放，点开查看器播）；
      第 4 格在媒体超过 4 个时叠 "+N" 角标，其余媒体在查看器里滑动 */
  const tile = (item: MediaView, index: number) => (
    <div
      key={item.id}
      onClick={(e) => open(e, index)}
      className="relative h-full w-full cursor-zoom-in overflow-hidden"
    >
      {item.type === 'video' ? (
        <>
          <video
            src={item.url}
            preload="metadata"
            muted
            className="pointer-events-none h-full w-full object-cover"
          />
          <i className="ri-play-circle-fill absolute right-1.5 bottom-1.5 text-[22px] text-white drop-shadow" />
        </>
      ) : (
        <img
          src={item.url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          draggable={false}
        />
      )}
      {index === 3 && media.length > 4 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-bold text-white">
          +{media.length - 4}
        </div>
      )}
    </div>
  );

  const maxHeight = compact ? 'max-h-72' : 'max-h-128';
  let body;
  if (media.length === 1) {
    const m = media[0]!;
    // 单图按原始比例展示（限高），无比例信息退化为 16:9
    const ratio = m.width && m.height ? `${m.width} / ${m.height}` : '16 / 9';
    body = (
      <div className={`w-full ${maxHeight}`} style={{ aspectRatio: ratio }}>
        {tile(m, 0)}
      </div>
    );
  } else if (media.length === 2) {
    body = (
      <div className="grid aspect-2/1 grid-cols-2 gap-0.5">
        {media.map((m, i) => tile(m, i))}
      </div>
    );
  } else if (media.length === 3) {
    body = (
      <div className="grid aspect-2/1 grid-cols-2 gap-0.5">
        {tile(media[0]!, 0)}
        <div className="grid grid-rows-2 gap-0.5">
          {tile(media[1]!, 1)}
          {tile(media[2]!, 2)}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="grid aspect-2/1 grid-cols-2 grid-rows-2 gap-0.5">
        {media.slice(0, 4).map((m, i) => tile(m, i))}
      </div>
    );
  }

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-x-border">
      {body}
      {lightbox !== null && (
        <MediaLightbox
          media={media}
          initialIndex={lightbox}
          {...(postId !== undefined ? { postId } : {})}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
