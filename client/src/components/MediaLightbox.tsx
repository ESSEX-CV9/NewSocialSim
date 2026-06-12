import type { MediaView } from '@socialsim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/endpoints';
import { patchPostById } from '../api/postCache';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { LoadMore } from './LoadMore';
import { PostActions } from './PostActions';
import { PostCard } from './PostCard';
import { PostContent } from './PostContent';
import { TimeAgo } from './TimeAgo';
import { usePagedQuery } from './usePagedQuery';
import { UserHoverCard } from './UserHoverCard';
import { VerifiedBadge } from './VerifiedBadge';
import { attachVideoPlayback } from './videoPlayback';

/** 查看器内的视频：有声自动播放，进度跨场景记忆；点击画面为默认播放/暂停行为 */
function LightboxVideo({ media }: { media: MediaView }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    return attachVideoPlayback(el, media.url);
  }, [media.url]);

  return (
    <video
      ref={videoRef}
      src={media.url}
      controls
      autoPlay
      onClick={(e) => e.stopPropagation()}
      className="max-h-full max-w-full"
    />
  );
}

/** 右侧帖子详情面板：作者 + 正文 + 互动栏 + 回复框 + 回复列表（与详情页共享缓存） */
function PostPanel({ postId }: { postId: number }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);

  const post = useQuery({ queryKey: ['post', postId], queryFn: () => api.getPost(postId) });
  const replies = usePagedQuery(['replies', postId], (cursor) => api.getReplies(postId, cursor));

  const view = post.data?.post;
  if (!view) return null;

  return (
    <div>
      <div className="px-4 pt-3">
        <div className="flex items-center gap-3">
          <UserHoverCard handle={view.author.handle}>
            <Link to={`/u/${view.author.handle}`}>
              <Avatar handle={view.author.handle} avatarUrl={view.author.avatarUrl} />
            </Link>
          </UserHoverCard>
          <div className="min-w-0">
            <UserHoverCard handle={view.author.handle}>
              <Link
                to={`/u/${view.author.handle}`}
                className="flex items-center gap-1 text-[15px] font-bold hover:underline"
              >
                <span className="truncate">{view.author.displayName}</span>
                <VerifiedBadge verified={view.author.verified} />
              </Link>
            </UserHoverCard>
            <div className="truncate text-[13px] text-x-dim">@{view.author.handle}</div>
          </div>
        </div>
        {view.deleted ? (
          <div className="mt-3 text-[15px] text-x-dim">{t('post.deleted')}</div>
        ) : (
          <>
            <div className="mt-2">
              <PostContent content={view.content} />
            </div>
            <Link
              to={`/post/${view.id}`}
              className="mt-2 inline-block text-[13px] text-x-dim hover:underline"
            >
              <TimeAgo at={view.createdAt} /> · {t('media.viewPost')}
            </Link>
            <div className="border-b border-x-border pb-3">
              <PostActions post={view} onReply={() => setComposerOpen(true)} />
            </div>
          </>
        )}
      </div>

      {/* 回复区：默认收起为窄条，点击展开为完整回复框（与详情页一致） */}
      {user &&
        !view.deleted &&
        (composerOpen ? (
          <div className="border-b border-x-border">
            <div className="px-4 pt-3 text-[14px] text-x-dim">
              {t('post.replyingTo', { handle: view.author.handle })}
            </div>
            <Composer
              replyToId={postId}
              placeholder={t('composer.replyPlaceholder')}
              buttonText={t('composer.reply')}
              autoFocus
              bordered={false}
              onPosted={() => {
                setComposerOpen(false);
                patchPostById(queryClient, postId, (p) => ({ replyCount: p.replyCount + 1 }));
                void queryClient.invalidateQueries({ queryKey: ['replies', postId] });
                void queryClient.invalidateQueries({ queryKey: ['post', postId] });
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setComposerOpen(true)}
            className="flex w-full cursor-text items-center gap-3 border-b border-x-border px-4 py-2.5 transition-colors duration-200 hover:bg-x-hover"
          >
            <Avatar handle={user.handle} avatarUrl={user.avatarUrl} size={32} />
            <span className="flex-1 text-left text-[15px] text-x-dim">
              {t('composer.replyPlaceholder')}
            </span>
          </button>
        ))}

      {replies.items.map((reply) => (
        <PostCard key={reply.id} post={reply} />
      ))}
      <LoadMore
        hasNextPage={!!replies.hasNextPage}
        isFetching={replies.isFetchingNextPage}
        onClick={() => void replies.fetchNextPage()}
      />
    </div>
  );
}

/**
 * 全屏媒体查看器：黑底居中原比例（图片/视频），多图左右切换，Esc/点空白关闭。
 * 经帖子打开（postId）时对照 X：媒体下方互动栏 + 右侧可收起的帖子详情面板（看回复/发回复）。
 */
export function MediaLightbox({
  media,
  initialIndex,
  onClose,
  postId,
}: {
  media: MediaView[];
  initialIndex: number;
  onClose: () => void;
  /** 来源帖子；提供时显示互动栏与详情面板（私信/头像查看等场景不带） */
  postId?: number;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState(initialIndex);
  const [panelOpen, setPanelOpen] = useState(true);
  const current = media[index];

  const post = useQuery({
    queryKey: ['post', postId],
    queryFn: () => api.getPost(postId!),
    enabled: postId !== undefined,
  });
  const view = postId !== undefined ? post.data?.post : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // 输入框聚焦时不抢左右方向键（回复框里移动光标）
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(media.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [media.length, onClose]);

  if (!current) return null;
  const stop = (e: MouseEvent) => e.stopPropagation();
  const showPanel = view !== undefined && panelOpen;

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
    <div className="fixed inset-0 z-50 flex">
      {/* 媒体区：点空白关闭 */}
      <div
        onClick={(e) => {
          stop(e);
          onClose();
        }}
        className="relative flex min-w-0 flex-1 flex-col bg-black/90"
      >
        <button
          aria-label={t('media.viewerClose')}
          onClick={(e) => {
            stop(e);
            onClose();
          }}
          className="absolute top-4 left-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-200 hover:bg-white/20"
        >
          <i className="ri-close-line text-[20px]" />
        </button>
        {media.length > 1 && (
          <div
            onClick={stop}
            className="absolute top-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[13px] text-white"
          >
            {index + 1} / {media.length}
          </div>
        )}
        {/* 收起/展开帖子详情面板（仅经帖子打开时） */}
        {view !== undefined && (
          <button
            aria-label={panelOpen ? t('media.hideDetail') : t('media.showDetail')}
            title={panelOpen ? t('media.hideDetail') : t('media.showDetail')}
            onClick={(e) => {
              stop(e);
              setPanelOpen((v) => !v);
            }}
            className="absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-200 hover:bg-white/20"
          >
            <i
              className={`${panelOpen ? 'ri-arrow-right-double-line' : 'ri-arrow-left-double-line'} text-[20px]`}
            />
          </button>
        )}
        <div className="relative flex min-h-0 flex-1 items-center justify-center p-12">
          {media.length > 1 && (
            <div className="absolute left-4 z-10" onClick={stop}>
              {navButton(-1, 'ri-arrow-left-s-line', t('media.prev'), index === 0)}
            </div>
          )}
          {current.type === 'video' ? (
            <LightboxVideo key={current.id} media={current} />
          ) : (
            <img
              src={current.url}
              alt=""
              onClick={stop}
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          )}
          {media.length > 1 && (
            <div className="absolute right-4 z-10" onClick={stop}>
              {navButton(1, 'ri-arrow-right-s-line', t('media.next'), index === media.length - 1)}
            </div>
          )}
        </div>
        {/* 媒体下方互动栏（与时间线一致，写穿共享缓存） */}
        {view !== undefined && !view.deleted && (
          <div onClick={stop} className="mx-auto w-full max-w-150 px-8 pb-3">
            <PostActions post={view} onReply={() => setPanelOpen(true)} />
          </div>
        )}
      </div>

      {/* 右侧帖子详情面板 */}
      {showPanel && (
        <aside
          onClick={stop}
          className="no-scrollbar w-87.5 shrink-0 overflow-y-auto border-l border-x-border bg-x-bg"
        >
          <PostPanel postId={postId!} />
        </aside>
      )}
    </div>
  );
}
