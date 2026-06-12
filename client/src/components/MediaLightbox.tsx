import type { MediaView } from '@socialsim/shared';
import { useEffect, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';

/** 全屏媒体查看器：黑底居中原比例（图片/视频），多图左右切换，Esc/点空白关闭 */
export function MediaLightbox({
  media,
  initialIndex,
  onClose,
  postId,
}: {
  media: MediaView[];
  initialIndex: number;
  onClose: () => void;
  /** 提供时显示"查看帖子"入口（媒体 Tab 等不经帖子打开的场景） */
  postId?: number;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [index, setIndex] = useState(initialIndex);
  const current = media[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(media.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [media.length, onClose]);

  if (!current) return null;
  const stop = (e: MouseEvent) => e.stopPropagation();

  const navButton = (dir: -1 | 1, icon: string, label: string, disabled: boolean) => (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        stop(e);
        setIndex((i) => i + dir);
      }}
      className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-200 hover:bg-white/20 disabled:opacity-30"
    >
      <i className={`${icon} text-[20px]`} />
    </button>
  );

  return (
    <div
      onClick={(e) => {
        stop(e);
        onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
    >
      <button
        aria-label={t('media.viewerClose')}
        onClick={(e) => {
          stop(e);
          onClose();
        }}
        className="absolute top-4 left-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-200 hover:bg-white/20"
      >
        <i className="ri-close-line text-[20px]" />
      </button>
      {postId !== undefined && (
        <button
          onClick={(e) => {
            stop(e);
            onClose();
            navigate(`/post/${postId}`);
          }}
          className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-white/20"
        >
          <i className="ri-chat-3-line text-[16px]" />
          {t('media.viewPost')}
        </button>
      )}
      {media.length > 1 && (
        <div className="absolute left-4" onClick={stop}>
          {navButton(-1, 'ri-arrow-left-s-line', t('media.prev'), index === 0)}
        </div>
      )}
      {current.type === 'video' ? (
        <video
          key={current.id}
          src={current.url}
          controls
          autoPlay
          onClick={stop}
          className="max-h-[90vh] max-w-[90vw]"
        />
      ) : (
        <img
          src={current.url}
          alt=""
          onClick={stop}
          className="max-h-[90vh] max-w-[90vw] object-contain"
          draggable={false}
        />
      )}
      {media.length > 1 && (
        <div className="absolute right-4" onClick={stop}>
          {navButton(1, 'ri-arrow-right-s-line', t('media.next'), index === media.length - 1)}
        </div>
      )}
    </div>
  );
}
