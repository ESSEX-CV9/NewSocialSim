import type { MediaView, UserProfile } from '@socialsim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { patchAuthorFollow } from '../../api/postCache';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { EmptyBox, ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { MediaLightbox } from '../../components/MediaLightbox';
import { PostCard } from '../../components/PostCard';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useFormatCount } from '../../i18n/formatCount';
import { useI18n } from '../../i18n/I18nContext';
import { EditProfileModal } from './EditProfileModal';

type ProfileTab = 'posts' | 'replies' | 'media' | 'likes';

const TAB_EMPTY: Record<ProfileTab, { icon: string; key: 'profile.emptyPosts' | 'profile.emptyReplies' | 'profile.emptyMedia' | 'profile.emptyLikes' }> = {
  posts: { icon: 'ri-chat-3-line', key: 'profile.emptyPosts' },
  replies: { icon: 'ri-reply-line', key: 'profile.emptyReplies' },
  media: { icon: 'ri-image-line', key: 'profile.emptyMedia' },
  likes: { icon: 'ri-heart-3-line', key: 'profile.emptyLikes' },
};

export function ProfilePage() {
  const { handle = '' } = useParams();
  const { user: viewer } = useAuth();
  const { t, locale } = useI18n();
  const fmt = useFormatCount();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('posts');
  // 媒体查看器：媒体 Tab 缩略图（带"查看帖子"入口）与头像/横幅大图共用
  const [mediaViewer, setMediaViewer] = useState<{
    media: MediaView[];
    index: number;
    postId?: number;
  } | null>(null);

  const profile = useQuery({
    queryKey: ['user', handle],
    queryFn: () => api.getUser(handle),
    enabled: handle.length > 0,
  });

  // 帖子/回复/喜欢三个列表懒加载：切到对应 Tab 才发请求
  // 帖子 Tab 是"原创 + 本人转发"的时间线（与 X 一致）
  const posts = usePagedQuery(
    ['user-timeline', handle],
    (cursor) => api.getUserTimeline(handle, cursor),
    { enabled: handle.length > 0 && tab === 'posts' },
  );
  const replies = usePagedQuery(
    ['user-posts', handle, 'replies'],
    (cursor) => api.getUserPosts(handle, cursor, 'replies'),
    { enabled: handle.length > 0 && tab === 'replies' },
  );
  const likes = usePagedQuery(
    ['user-likes', handle],
    (cursor) => api.getUserLikes(handle, cursor),
    { enabled: handle.length > 0 && tab === 'likes' },
  );
  const mediaPosts = usePagedQuery(
    ['user-media', handle],
    (cursor) => api.getUserMedia(handle, cursor),
    { enabled: handle.length > 0 && tab === 'media' },
  );

  // 置顶帖单独请求，渲染在帖子 Tab 顶部（后端时间线已排除该帖避免重复）
  const pinnedPostId = profile.data?.user.pinnedPostId ?? null;
  const pinnedQuery = useQuery({
    queryKey: ['post', pinnedPostId],
    queryFn: () => api.getPost(pinnedPostId!),
    enabled: tab === 'posts' && pinnedPostId !== null,
  });

  if (profile.isLoading) return <Spinner />;
  if (profile.isError) return <ErrorBox error={profile.error} />;
  if (!profile.data) return null;
  const u = profile.data.user;
  const isMe = viewer?.id === u.id;
  const isFollowing = u.followedByViewer;

  const toggleFollow = async () => {
    const res = isFollowing ? await api.unfollow(handle) : await api.follow(handle);
    // 写穿 profile 缓存保证按钮即时翻转；invalidate 兜底校准真实计数
    queryClient.setQueryData<{ user: UserProfile }>(['user', handle], (old) =>
      old
        ? {
            user: {
              ...old.user,
              followedByViewer: res.following,
              followerCount: old.user.followerCount + (res.following ? 1 : -1),
            },
          }
        : old,
    );
    patchAuthorFollow(queryClient, u.id, res.following);
    void queryClient.invalidateQueries({ queryKey: ['user', handle] });
    if (viewer) void queryClient.invalidateQueries({ queryKey: ['user', viewer.handle] });
    void queryClient.invalidateQueries({ queryKey: ['suggested-users'] });
  };

  const unblock = async () => {
    await api.unblockUser(handle);
    for (const key of [
      ['user', handle],
      ['timeline'],
      ['notifications'],
      ['unread-count'],
      ['suggested-users'],
      ['search-posts'],
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const joinedDate = new Date(u.createdAt).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
  });

  const activeList = tab === 'replies' ? replies : tab === 'likes' ? likes : null;

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['user-timeline', handle] });
    void queryClient.invalidateQueries({ queryKey: ['user-posts', handle] });
    void queryClient.invalidateQueries({ queryKey: ['user-likes', handle] });
    void queryClient.invalidateQueries({ queryKey: ['user', handle] });
  };

  const tabClass = (active: boolean) =>
    `flex h-13.25 flex-1 cursor-pointer items-center justify-center text-[15px] font-medium transition-colors duration-200 hover:bg-x-hover ${
      active ? 'tab-active' : 'text-x-dim'
    }`;

  return (
    <div>
      {/* 顶部标题栏：返回 + 名字 + 帖子数 */}
      <div className="glass-header flex h-13.25 items-center px-4">
        <button
          onClick={() => navigate(-1)}
          className="mr-6 flex size-8.5 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
        >
          <i className="ri-arrow-left-line text-[18px]" />
        </button>
        <div>
          <div className="text-xl leading-tight font-bold">{u.displayName}</div>
          <div className="text-[13px] text-x-dim">{t('profile.postCount', { n: fmt(u.postCount) })}</div>
        </div>
      </div>

      {/* Banner：有上传图用图片（可点击放大），否则纯色占位 */}
      {u.bannerUrl ? (
        <img
          src={u.bannerUrl}
          alt=""
          onClick={() =>
            setMediaViewer({
              media: [
                { id: u.bannerMediaId ?? 0, type: 'image', url: u.bannerUrl!, width: null, height: null },
              ],
              index: 0,
            })
          }
          className="h-50 w-full cursor-pointer object-cover"
          draggable={false}
        />
      ) : (
        <div className="h-50 w-full bg-x-input" />
      )}

      {/* 资料区 */}
      <div className="border-b border-x-border px-4 py-3">
        <div className="-mt-13 flex items-start justify-between">
          <div
            onClick={() => {
              if (u.avatarUrl) {
                setMediaViewer({
                  media: [
                    { id: u.avatarMediaId ?? 0, type: 'image', url: u.avatarUrl, width: null, height: null },
                  ],
                  index: 0,
                });
              }
            }}
            className={`rounded-full border-4 border-x-bg ${u.avatarUrl ? 'cursor-pointer' : ''}`}
          >
            <Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={80} />
          </div>
          <div className="mt-13 pt-1">
            {isMe ? (
              <button
                onClick={() => setEditing((v) => !v)}
                className="rounded-full border border-x-dim px-4 py-1.5 text-[14px] font-bold transition-colors duration-200 hover:bg-x-input"
              >
                {t('profile.editProfile')}
              </button>
            ) : (
              viewer &&
              (u.blockedByViewer ? (
                <button
                  onClick={() => void unblock()}
                  className="rounded-full border border-x-red px-4 py-1.5 text-[14px] font-bold text-x-red transition-colors duration-200 hover:bg-x-red/10"
                >
                  {t('profile.unblock')}
                </button>
              ) : (
                <button
                  onClick={() => void toggleFollow()}
                  className={`rounded-full px-4 py-1.5 text-[14px] font-bold transition-colors duration-200 ${
                    isFollowing
                      ? 'border border-x-dim text-x-text hover:border-x-red/60 hover:bg-x-red/10 hover:text-x-red'
                      : 'bg-x-text text-x-bg hover:opacity-90'
                  }`}
                >
                  {isFollowing ? t('profile.unfollow') : t('profile.follow')}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold">{u.displayName}</h1>
            {u.isBot && (
              <span className="rounded bg-x-input px-1.5 py-0.5 text-xs text-x-dim">
                <i className="ri-robot-2-line mr-1" />
                {t('profile.bot')}
              </span>
            )}
          </div>
          <div className="text-[15px] text-x-dim">@{u.handle}</div>
        </div>

        {u.bio && <p className="mt-3 text-[15px] whitespace-pre-wrap">{u.bio}</p>}

        <div className="mt-3 flex items-center gap-1 text-[14px] text-x-dim">
          <i className="ri-calendar-line" />
          <span>{t('profile.joined', { date: joinedDate })}</span>
        </div>

        {u.blockedByViewer && (
          <div className="mt-2 flex items-center gap-1 text-[14px] text-x-dim">
            <i className="ri-forbid-line" />
            <span>{t('profile.blockedNotice')}</span>
          </div>
        )}

        <div className="mt-3 flex gap-5 text-[14px] text-x-dim">
          <Link to={`/u/${handle}/following`} className="hover:underline">
            <b className="text-x-text">{fmt(u.followingCount)}</b> {t('profile.following')}
          </Link>
          <Link to={`/u/${handle}/followers`} className="hover:underline">
            <b className="text-x-text">{fmt(u.followerCount)}</b> {t('profile.followers')}
          </Link>
        </div>
      </div>

      {editing && isMe && <EditProfileModal onClose={() => setEditing(false)} />}

      {/* 四 Tab：帖子 / 回复 / 媒体 / 喜欢 */}
      <div className="flex border-b border-x-border">
        {(['posts', 'replies', 'media', 'likes'] as const).map((key) => (
          <button key={key} className={tabClass(tab === key)} onClick={() => setTab(key)}>
            {t(
              key === 'posts'
                ? 'profile.tabPosts'
                : key === 'replies'
                  ? 'profile.tabReplies'
                  : key === 'media'
                    ? 'profile.tabMedia'
                    : 'profile.tabLikes',
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {tab === 'media' && (
        <>
          {mediaPosts.isLoading && <Spinner />}
          {mediaPosts.isError && <ErrorBox error={mediaPosts.error} />}
          <div className="grid grid-cols-3 gap-0.5 p-0.5">
            {mediaPosts.items.flatMap((post) =>
              post.media.map((m, mi) => (
                <button
                  key={`${post.id}-${m.id}`}
                  onClick={() => setMediaViewer({ media: post.media, index: mi, postId: post.id })}
                  className="relative aspect-square overflow-hidden bg-x-input"
                >
                  {m.type === 'video' ? (
                    <>
                      <video src={m.url} preload="metadata" muted className="h-full w-full object-cover" />
                      <i className="ri-play-circle-fill absolute right-1.5 bottom-1.5 text-[22px] text-white drop-shadow" />
                    </>
                  ) : (
                    <img src={m.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  )}
                </button>
              )),
            )}
          </div>
          {mediaPosts.isSuccess && mediaPosts.items.length === 0 && (
            <EmptyBox icon={TAB_EMPTY.media.icon} text={t(TAB_EMPTY.media.key)} />
          )}
          <LoadMore
            hasNextPage={!!mediaPosts.hasNextPage}
            isFetching={mediaPosts.isFetchingNextPage}
            onClick={() => void mediaPosts.fetchNextPage()}
          />
        </>
      )}
      {tab === 'posts' && (
        <>
          {posts.isLoading && <Spinner />}
          {posts.isError && <ErrorBox error={posts.error} />}
          {pinnedQuery.data && !pinnedQuery.data.post.deleted && (
            <PostCard post={pinnedQuery.data.post} pinned onDeleted={refreshLists} />
          )}
          {posts.items.map((item, i) => (
            <PostCard
              key={`${item.type}-${item.post.id}-${i}`}
              post={item.post}
              repostedBy={item.repostedBy}
              onDeleted={refreshLists}
            />
          ))}
          {posts.isSuccess && posts.items.length === 0 && (
            <EmptyBox icon={TAB_EMPTY.posts.icon} text={t(TAB_EMPTY.posts.key)} />
          )}
          <LoadMore
            hasNextPage={!!posts.hasNextPage}
            isFetching={posts.isFetchingNextPage}
            onClick={() => void posts.fetchNextPage()}
          />
        </>
      )}
      {activeList && (
        <>
          {activeList.isLoading && <Spinner />}
          {activeList.isError && <ErrorBox error={activeList.error} />}
          {activeList.items.map((post) =>
            // 回复 Tab：被回复帖可见时渲染为对话串（上半卡 + 连接线 + 回复卡），
            // 不可见时回复卡内降级显示"回复 @handle"
            tab === 'replies' && post.inReplyTo ? (
              <div key={post.id}>
                <PostCard post={post.inReplyTo} threadTop onDeleted={refreshLists} />
                <PostCard post={post} onDeleted={refreshLists} />
              </div>
            ) : (
              <PostCard
                key={post.id}
                post={post}
                replyToFallbackHandle={
                  tab === 'replies' ? (post.replyToHandle ?? undefined) : undefined
                }
                onDeleted={refreshLists}
              />
            ),
          )}
          {activeList.isSuccess && activeList.items.length === 0 && (
            <EmptyBox icon={TAB_EMPTY[tab].icon} text={t(TAB_EMPTY[tab].key)} />
          )}
          <LoadMore
            hasNextPage={!!activeList.hasNextPage}
            isFetching={activeList.isFetchingNextPage}
            onClick={() => void activeList.fetchNextPage()}
          />
        </>
      )}

      {/* 媒体查看器：媒体 Tab 缩略图与头像/横幅大图共用（后者无"查看帖子"入口） */}
      {mediaViewer && (
        <MediaLightbox
          media={mediaViewer.media}
          initialIndex={mediaViewer.index}
          {...(mediaViewer.postId !== undefined ? { postId: mediaViewer.postId } : {})}
          onClose={() => setMediaViewer(null)}
        />
      )}
    </div>
  );
}
