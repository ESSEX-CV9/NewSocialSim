import type { PostView, UserSummary } from '@socialsim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useFormatCount } from '../i18n/formatCount';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { LinkCard } from './LinkCard';
import { MediaGrid } from './MediaGrid';
import { TimeAgo } from './TimeAgo';
import { useViewTracking } from './useViewTracking';

/** 帖子正文：URL 转外链，#话题 转搜索链接，@用户名 转主页链接 */
function PostContent({ content }: { content: string }) {
  const parts = content.split(/(https?:\/\/[^\s]+|#[^\s#@]+|@[a-zA-Z0-9_]{2,20})/g);
  return (
    <p className="text-[15px] leading-normal wrap-break-word whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (part.startsWith('http://') || part.startsWith('https://')) {
          const display = part.replace(/^https?:\/\/(www\.)?/, '');
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-x-blue hover:underline"
            >
              {display.length > 36 ? `${display.slice(0, 36)}…` : display}
            </a>
          );
        }
        if (part.startsWith('#')) {
          return (
            <Link
              key={i}
              to={`/search?q=${encodeURIComponent(part)}&type=posts`}
              onClick={(e) => e.stopPropagation()}
              className="text-x-blue hover:underline"
            >
              {part}
            </Link>
          );
        }
        if (part.startsWith('@')) {
          return (
            <Link
              key={i}
              to={`/u/${part.slice(1)}`}
              onClick={(e) => e.stopPropagation()}
              className="text-x-blue hover:underline"
            >
              {part}
            </Link>
          );
        }
        return part;
      })}
    </p>
  );
}

function Tombstone({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border-2 border-x-border bg-x-card p-4 text-[15px] text-x-dim">
      {t('post.deleted')}
      {children}
    </div>
  );
}

/** 被引用帖子的嵌入卡片 */
function QuotedCard({ quoted }: { quoted: PostView }) {
  const navigate = useNavigate();
  if (quoted.deleted) return <Tombstone />;
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/post/${quoted.id}`);
      }}
      className="mt-2 cursor-pointer rounded-xl border-2 border-x-border p-3 transition-colors duration-200 hover:bg-x-hover"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[15px]">
        <Avatar handle={quoted.author.handle} avatarUrl={quoted.author.avatarUrl} size={20} />
        <span className="font-bold">{quoted.author.displayName}</span>
        <span className="text-x-dim">@{quoted.author.handle}</span>
        <span className="text-x-dim">·</span>
        <TimeAgo at={quoted.createdAt} />
      </div>
      <PostContent content={quoted.content} />
      {quoted.media.length > 0 && <MediaGrid media={quoted.media} compact />}
    </div>
  );
}

/** 互动按钮：FA 图标 + 计数，hover 时图标出现同色 10% 圆形气泡 */
function ActionButton({
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

interface PostCardProps {
  post: PostView;
  repostedBy?: UserSummary | null;
  /** 详情页大字号模式 */
  large?: boolean;
  /** 个人主页置顶帖标记 */
  pinned?: boolean;
  onDeleted?: (id: number) => void;
}

export function PostCard({ post, repostedBy, large, pinned, onDeleted }: PostCardProps) {
  const { user, setUser } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [liked, setLiked] = useState(post.likedByViewer);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reposted, setReposted] = useState(post.repostedByViewer);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [quoteCount, setQuoteCount] = useState(post.quoteCount);
  const [bookmarked, setBookmarked] = useState(post.bookmarkedByViewer);
  const [authorFollowed, setAuthorFollowed] = useState(post.authorFollowedByViewer);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [repostMenuOpen, setRepostMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const viewRef = useViewTracking(post.id, !post.deleted && !gone);

  if (gone) return null;
  if (post.deleted) {
    return (
      <div className="border-b border-x-border p-4">
        <Tombstone />
      </div>
    );
  }

  const stop = (e: MouseEvent) => e.stopPropagation();

  const toggleLike = async (e: MouseEvent) => {
    stop(e);
    if (!user) return navigate('/login');
    const res = liked ? await api.unlike(post.id) : await api.like(post.id);
    setLiked(res.active);
    setLikeCount(res.count);
  };

  const toggleRepost = async () => {
    const res = reposted ? await api.unrepost(post.id) : await api.repost(post.id);
    setReposted(res.active);
    setRepostCount(res.count);
  };

  const toggleBookmark = async (e: MouseEvent) => {
    stop(e);
    if (!user) return navigate('/login');
    const res = bookmarked ? await api.unbookmark(post.id) : await api.bookmark(post.id);
    setBookmarked(res.active);
  };

  const remove = async () => {
    if (!window.confirm(t('post.deleteConfirm'))) return;
    await api.deletePost(post.id);
    setGone(true);
    onDeleted?.(post.id);
  };

  const isPinned = user?.pinnedPostId === post.id;

  const togglePin = async () => {
    if (!user) return;
    const res = isPinned ? await api.unpinPost(post.id) : await api.pinPost(post.id);
    setUser({ ...user, pinnedPostId: res.pinnedPostId });
    void queryClient.invalidateQueries({ queryKey: ['user-timeline', user.handle] });
    void queryClient.invalidateQueries({ queryKey: ['user', user.handle] });
  };

  const toggleAuthorFollow = async () => {
    const res = authorFollowed
      ? await api.unfollow(post.author.handle)
      : await api.follow(post.author.handle);
    setAuthorFollowed(res.following);
    void queryClient.invalidateQueries({ queryKey: ['user', post.author.handle] });
    void queryClient.invalidateQueries({ queryKey: ['suggested-users'] });
  };

  const blockAuthor = async () => {
    if (!window.confirm(t('post.blockConfirm', { handle: post.author.handle }))) return;
    await api.blockUser(post.author.handle);
    setGone(true);
    onDeleted?.(post.id);
    for (const key of [
      ['timeline'],
      ['user-timeline'],
      ['user-posts'],
      ['user-likes'],
      ['replies'],
      ['notifications'],
      ['unread-count'],
      ['search-posts'],
      ['suggested-users'],
      ['user', post.author.handle],
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const hidePost = async () => {
    await api.hidePost(post.id);
    setGone(true);
    onDeleted?.(post.id);
    for (const key of [['timeline'], ['replies'], ['search-posts']]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  /** 菜单项统一外观；点击后关菜单再执行 */
  const menuItem = (icon: string, label: string, action: () => void, danger = false) => (
    <button
      onClick={(e) => {
        stop(e);
        setMoreMenuOpen(false);
        action();
      }}
      className={`flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold transition-colors duration-200 hover:bg-x-input ${
        danger ? 'text-x-red' : 'text-x-text'
      }`}
    >
      <i className={icon} />
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <article
      ref={viewRef}
      onClick={() => !large && navigate(`/post/${post.id}`)}
      className={`border-b border-x-border px-4 py-3 ${
        large ? '' : 'cursor-pointer transition-colors duration-200 hover:bg-x-hover'
      }`}
    >
      {pinned && (
        <div className="mb-1 ml-8 flex items-center gap-2 text-[13px] font-bold text-x-dim">
          <i className="ri-pushpin-fill" />
          {t('post.pinned')}
        </div>
      )}
      {repostedBy && (
        <div className="mb-1 ml-8 flex items-center gap-2 text-[13px] font-bold text-x-dim">
          <i className="ri-repeat-2-line" />
          {t('timeline.repostedBy', { name: repostedBy.displayName })}
        </div>
      )}
      <div className="flex gap-3">
        <Link to={`/u/${post.author.handle}`} onClick={stop} className="self-start">
          <Avatar handle={post.author.handle} avatarUrl={post.author.avatarUrl} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-x-1 text-[15px]">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
              <Link
                to={`/u/${post.author.handle}`}
                onClick={stop}
                className="font-bold hover:underline"
              >
                {post.author.displayName}
              </Link>
              {post.author.isBot && (
                <span className="ml-0.5 rounded bg-x-input px-1 text-xs text-x-dim">
                  {t('profile.bot')}
                </span>
              )}
              <span className="ml-0.5 text-x-dim">@{post.author.handle}</span>
              <span className="text-x-dim">·</span>
              <TimeAgo at={post.createdAt} />
            </div>
            {/* 右上角"…"菜单：本人帖=删除/置顶；他人帖=关注/屏蔽/隐藏 */}
            {user && (
              <span className="relative" onClick={stop}>
                <ActionButton
                  icon="ri-more-fill"
                  color="blue"
                  onClick={() => setMoreMenuOpen((v) => !v)}
                />
                {moreMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={(e) => {
                        stop(e);
                        setMoreMenuOpen(false);
                      }}
                    />
                    <div className="absolute top-6 right-0 z-30 w-fit min-w-44 overflow-hidden rounded-xl border border-x-border bg-x-card whitespace-nowrap shadow-lg">
                      {user.id === post.authorId ? (
                        <>
                          {menuItem('ri-delete-bin-line', t('post.delete'), () => void remove(), true)}
                          {menuItem(
                            isPinned ? 'ri-unpin-line' : 'ri-pushpin-line',
                            isPinned ? t('post.unpin') : t('post.pin'),
                            () => void togglePin(),
                          )}
                        </>
                      ) : (
                        <>
                          {menuItem(
                            authorFollowed ? 'ri-user-unfollow-line' : 'ri-user-follow-line',
                            authorFollowed
                              ? t('post.unfollowAuthor', { handle: post.author.handle })
                              : t('post.followAuthor', { handle: post.author.handle }),
                            () => void toggleAuthorFollow(),
                          )}
                          {menuItem(
                            'ri-forbid-line',
                            t('post.blockAuthor', { handle: post.author.handle }),
                            () => void blockAuthor(),
                            true,
                          )}
                          {menuItem('ri-eye-off-line', t('post.hide'), () => void hidePost())}
                        </>
                      )}
                    </div>
                  </>
                )}
              </span>
            )}
          </div>
          <div className={large ? 'mt-2 text-xl' : 'mt-0.5'}>
            <PostContent content={post.content} />
          </div>
          {post.media.length > 0 && <MediaGrid media={post.media} />}
          {post.linkCard && <LinkCard card={post.linkCard} />}
          {post.quoted && <QuotedCard quoted={post.quoted} />}
          {/* 各按钮包 flex-1 左对齐单元格：图标位置不随数字宽度移动（与 X 一致） */}
          <div className="mt-3 flex items-center">
            <div className="flex-1">
              <ActionButton icon="ri-chat-3-line" count={post.replyCount} color="blue" />
            </div>
            {/* 转发/引用合并：点击弹原地下拉菜单（与 X 一致） */}
            <div className="flex-1">
            <span className="relative">
              <ActionButton
                icon="ri-repeat-2-line"
                count={repostCount + quoteCount}
                color="green"
                active={reposted}
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
                      {reposted ? t('post.unrepost') : t('post.repost')}
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
                icon={liked ? 'ri-heart-3-fill' : 'ri-heart-3-line'}
                count={likeCount}
                color="pink"
                active={liked}
                onClick={(e) => void toggleLike(e)}
              />
            </div>
            {/* 浏览量：仅展示，无动作（stopPropagation 防整卡跳详情） */}
            <div className="flex-1">
              <ActionButton icon="ri-bar-chart-2-line" count={post.viewCount} color="blue" onClick={stop} />
            </div>
            <ActionButton
              icon={bookmarked ? 'ri-bookmark-fill' : 'ri-bookmark-line'}
              color="blue"
              active={bookmarked}
              onClick={(e) => void toggleBookmark(e)}
            />
          </div>
        </div>
      </div>

      {quoteOpen && (
        <div
          onClick={(e) => {
            stop(e);
            setQuoteOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20"
        >
          <div
            onClick={stop}
            className="w-full max-w-xl rounded-2xl border border-x-border bg-x-bg"
          >
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
                setQuoteCount((c) => c + 1);
                navigate(`/post/${p.id}`);
              }}
            />
            <div className="px-4 pb-4">
              <QuotedCard quoted={post} />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
