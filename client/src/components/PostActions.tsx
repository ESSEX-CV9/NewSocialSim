import type { PostView } from '@socialsim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import { patchPostById } from '../api/postCache';
import { useAuth } from '../auth/AuthContext';
import { useFormatCount } from '../i18n/formatCount';
import { useI18n } from '../i18n/I18nContext';
import { Composer } from './Composer';
import { QuotedCard } from './QuotedCard';

/** 互动按钮：图标 + 计数，hover 时图标出现同色 10% 圆形气泡 */
export function ActionButton({
  icon,
  count,
  label,
  color,
  active,
  onClick,
}: {
  icon: string;
  count?: number | undefined;
  label?: string | undefined;
  color: 'blue' | 'green' | 'pink' | 'red';
  active?: boolean | undefined;
  onClick?: ((e: MouseEvent) => void) | undefined;
}) {
  const fmt = useFormatCount();
  const colorClass = {
    blue: { text: 'hover:text-x-blue', bubble: 'group-hover/act:bg-x-blue/10', on: 'text-x-blue' },
    green: {
      text: 'hover:text-x-green',
      bubble: 'group-hover/act:bg-x-green/10',
      on: 'text-x-green',
    },
    pink: { text: 'hover:text-x-pink', bubble: 'group-hover/act:bg-x-pink/10', on: 'text-x-pink' },
    red: { text: 'hover:text-x-red', bubble: 'group-hover/act:bg-x-red/10', on: 'text-x-red' },
  }[color];

  return (
    <button
      onClick={onClick}
      className={`group/act flex items-center text-[13px] transition-colors duration-200 ${
        active ? colorClass.on : 'text-x-dim'
      } ${colorClass.text}`}
    >
      <span
        className={`-m-2 flex size-8.5 items-center justify-center rounded-full transition-colors duration-200 ${colorClass.bubble}`}
      >
        <i className={`${icon} text-[16px]`} />
      </span>
      {count !== undefined && count > 0 && <span className="ml-2.5">{fmt(count)}</span>}
      {label && <span className="ml-2.5">{label}</span>}
    </button>
  );
}

/**
 * 帖子互动栏：回复计数 / 转发·引用菜单 / 赞 / 浏览量 / 书签（写穿全站缓存）。
 * PostCard 与媒体查看器共用；onReply 缺省时回复按钮不拦截点击（冒泡走整卡跳详情）。
 */
export function PostActions({
  post,
  onReply,
}: {
  post: PostView;
  onReply?: (() => void) | undefined;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [repostMenuOpen, setRepostMenuOpen] = useState(false);

  const stop = (e: MouseEvent) => e.stopPropagation();

  const toggleLike = async (e: MouseEvent) => {
    stop(e);
    if (!user) return navigate('/login');
    const res = post.likedByViewer ? await api.unlike(post.id) : await api.like(post.id);
    patchPostById(queryClient, post.id, () => ({ likedByViewer: res.active, likeCount: res.count }));
    void queryClient.invalidateQueries({ queryKey: ['user-likes', user.handle], refetchType: 'none' });
  };

  const toggleRepost = async () => {
    const res = post.repostedByViewer ? await api.unrepost(post.id) : await api.repost(post.id);
    patchPostById(queryClient, post.id, () => ({
      repostedByViewer: res.active,
      repostCount: res.count,
    }));
    if (user) {
      void queryClient.invalidateQueries({ queryKey: ['timeline'], refetchType: 'none' });
      void queryClient.invalidateQueries({
        queryKey: ['user-timeline', user.handle],
        refetchType: 'none',
      });
    }
  };

  const toggleBookmark = async (e: MouseEvent) => {
    stop(e);
    if (!user) return navigate('/login');
    const res = post.bookmarkedByViewer ? await api.unbookmark(post.id) : await api.bookmark(post.id);
    patchPostById(queryClient, post.id, () => ({ bookmarkedByViewer: res.active }));
    void queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
  };

  return (
    <>
      {/* 各按钮包 flex-1 左对齐单元格：图标位置不随数字宽度移动（与 X 一致） */}
      <div className="mt-3 flex items-center">
        <div className="flex-1">
          <ActionButton
            icon="ri-chat-3-line"
            count={post.replyCount}
            color="blue"
            onClick={
              onReply
                ? (e) => {
                    stop(e);
                    onReply();
                  }
                : undefined
            }
          />
        </div>
        {/* 转发/引用合并：点击弹原地下拉菜单（与 X 一致） */}
        <div className="flex-1">
          <span className="relative">
            <ActionButton
              icon="ri-repeat-2-line"
              count={post.repostCount + post.quoteCount}
              color="green"
              active={post.repostedByViewer}
              onClick={(e) => {
                stop(e);
                if (!user) return navigate('/login');
                setRepostMenuOpen((v) => !v);
              }}
            />
            {repostMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={(e) => {
                    stop(e);
                    setRepostMenuOpen(false);
                  }}
                />
                <div className="absolute top-6 left-0 z-30 w-36 overflow-hidden rounded-xl border border-x-border bg-x-card shadow-lg">
                  <button
                    onClick={(e) => {
                      stop(e);
                      setRepostMenuOpen(false);
                      void toggleRepost();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold text-x-text transition-colors duration-200 hover:bg-x-input"
                  >
                    <i className="ri-repeat-2-line" />
                    {post.repostedByViewer ? t('post.unrepost') : t('post.repost')}
                  </button>
                  <button
                    onClick={(e) => {
                      stop(e);
                      setRepostMenuOpen(false);
                      setQuoteOpen(true);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold text-x-text transition-colors duration-200 hover:bg-x-input"
                  >
                    <i className="ri-edit-line" />
                    {t('post.quote')}
                  </button>
                </div>
              </>
            )}
          </span>
        </div>
        <div className="flex-1">
          <ActionButton
            icon={post.likedByViewer ? 'ri-heart-3-fill' : 'ri-heart-3-line'}
            count={post.likeCount}
            color="pink"
            active={post.likedByViewer}
            onClick={(e) => void toggleLike(e)}
          />
        </div>
        {/* 浏览量：仅展示，无动作（stopPropagation 防整卡跳详情） */}
        <div className="flex-1">
          <ActionButton icon="ri-bar-chart-2-line" count={post.viewCount} color="blue" onClick={stop} />
        </div>
        <ActionButton
          icon={post.bookmarkedByViewer ? 'ri-bookmark-fill' : 'ri-bookmark-line'}
          color="blue"
          active={post.bookmarkedByViewer}
          onClick={(e) => void toggleBookmark(e)}
        />
      </div>

      {quoteOpen && (
        <div
          onClick={(e) => {
            stop(e);
            setQuoteOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20"
        >
          <div onClick={stop} className="w-full max-w-xl rounded-2xl border border-x-border bg-x-bg">
            <div className="flex items-center p-2">
              <button
                onClick={(e) => {
                  stop(e);
                  setQuoteOpen(false);
                }}
                className="flex size-9 items-center justify-center rounded-full text-x-text transition-colors duration-200 hover:bg-x-input"
              >
                <i className="ri-close-line text-[18px]" />
              </button>
            </div>
            <Composer
              quoteOfId={post.id}
              placeholder={t('composer.quotePlaceholder')}
              buttonText={t('composer.send')}
              autoFocus
              bordered={false}
              onPosted={(p) => {
                setQuoteOpen(false);
                patchPostById(queryClient, post.id, (old) => ({ quoteCount: old.quoteCount + 1 }));
                navigate(`/post/${p.id}`);
              }}
            />
            <div className="px-4 pb-4">
              <QuotedCard quoted={post} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
