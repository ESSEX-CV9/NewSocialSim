import type { PostView, UserSummary } from '@socialsim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import { patchAuthorFollow, patchPostById } from '../api/postCache';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';
import { useConfirm } from './ConfirmProvider';
import { LinkCard } from './LinkCard';
import { PostActions, ActionButton } from './PostActions';
import { PostContent } from './PostContent';
import { QuotedCard, Tombstone } from './QuotedCard';
import { VerifiedBadge } from './VerifiedBadge';
import { MediaGrid } from './MediaGrid';
import { TimeAgo } from './TimeAgo';
import { UserHoverCard } from './UserHoverCard';
import { useViewTracking } from './useViewTracking';

interface PostCardProps {
  post: PostView;
  repostedBy?: UserSummary | null;
  /** 详情页大字号模式 */
  large?: boolean;
  /** 个人主页置顶帖标记 */
  pinned?: boolean;
  /** 对话串上半卡（回复 Tab 的被回复帖）：头像下延伸连接线、去底边框 */
  threadTop?: boolean;
  /** 被回复帖对观察者不可见时的降级显示：正文上方"回复 @handle"行 */
  replyToFallbackHandle?: string | undefined;
  onDeleted?: (id: number) => void;
}

export function PostCard({
  post,
  repostedBy,
  large,
  pinned,
  threadTop,
  replyToFallbackHandle,
  onDeleted,
}: PostCardProps) {
  const { user, setUser } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const confirm = useConfirm();
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

  const remove = async () => {
    setMoreMenuOpen(false);
    if (!(await confirm({ title: t('post.deleteConfirm'), confirmLabel: t('post.delete'), danger: true })))
      return;
    await api.deletePost(post.id);
    patchPostById(queryClient, post.id, () => ({ deleted: true }));
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
    const res = post.authorFollowedByViewer
      ? await api.unfollow(post.author.handle)
      : await api.follow(post.author.handle);
    patchAuthorFollow(queryClient, post.authorId, res.following);
    void queryClient.invalidateQueries({ queryKey: ['user', post.author.handle] });
    if (user) void queryClient.invalidateQueries({ queryKey: ['user', user.handle] });
    void queryClient.invalidateQueries({ queryKey: ['suggested-users'] });
  };

  const blockAuthor = async () => {
    setMoreMenuOpen(false);
    if (!(await confirm({ title: t('post.blockConfirm', { handle: post.author.handle }), danger: true })))
      return;
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
      className={`px-4 py-3 ${threadTop ? '' : 'border-b border-x-border'} ${
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
          <UserHoverCard handle={repostedBy.handle}>
            <span>
              {user && repostedBy.id === user.id
                ? t('timeline.repostedByYou')
                : t('timeline.repostedBy', { name: repostedBy.displayName })}
            </span>
          </UserHoverCard>
        </div>
      )}
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <UserHoverCard handle={post.author.handle}>
            <Link to={`/u/${post.author.handle}`} onClick={stop}>
              <Avatar handle={post.author.handle} avatarUrl={post.author.avatarUrl} />
            </Link>
          </UserHoverCard>
          {/* 对话串连接线：从头像下缘延伸到卡片底部，与下方回复卡的头像相接 */}
          {threadTop && <div className="mt-1 -mb-3 w-0.5 flex-1 bg-x-border" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-x-1 text-[15px]">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
              <UserHoverCard handle={post.author.handle}>
                <Link
                  to={`/u/${post.author.handle}`}
                  onClick={stop}
                  className="font-bold hover:underline"
                >
                  {post.author.displayName}
                </Link>
              </UserHoverCard>
              <VerifiedBadge verified={post.author.verified} />
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
                            post.authorFollowedByViewer
                              ? 'ri-user-unfollow-line'
                              : 'ri-user-follow-line',
                            post.authorFollowedByViewer
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
          {/* 被回复帖不可见（已删/被屏蔽/被隐藏）时的降级行（与 X 一致） */}
          {replyToFallbackHandle && (
            <div className="text-[15px] text-x-dim">
              {t('post.replyTo')}{' '}
              <Link
                to={`/u/${replyToFallbackHandle}`}
                onClick={stop}
                className="text-x-blue hover:underline"
              >
                @{replyToFallbackHandle}
              </Link>
            </div>
          )}
          <div className={large ? 'mt-2 text-xl' : 'mt-0.5'}>
            <PostContent content={post.content} />
          </div>
          {post.media.length > 0 && <MediaGrid media={post.media} postId={post.id} />}
          {post.linkCard && <LinkCard card={post.linkCard} />}
          {post.quoted && <QuotedCard quoted={post.quoted} />}
          <PostActions post={post} />
        </div>
      </div>
    </article>
  );
}
