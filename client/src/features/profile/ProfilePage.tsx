import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { EmptyBox, ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { PostCard } from '../../components/PostCard';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useI18n } from '../../i18n/I18nContext';
import { inputClass } from '../auth/LoginPage';

type ProfileTab = 'posts' | 'replies' | 'media' | 'likes';

function EditProfileForm({ onDone }: { onDone: () => void }) {
  const { user, setUser } = useAuth();
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.updateMe({ displayName, bio });
      setUser(res.user);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-x-border p-4">
      <label className="text-[13px] text-x-dim">{t('profile.displayName')}</label>
      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
      <label className="text-[13px] text-x-dim">{t('profile.bio')}</label>
      <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className={inputClass} />
      <div className="flex justify-end gap-2">
        <button
          onClick={onDone}
          className="rounded-full px-4 py-1.5 text-[15px] text-x-dim transition-colors duration-200 hover:bg-x-input"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || displayName.trim().length === 0}
          className="rounded-full bg-x-blue px-4 py-1.5 text-[15px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [tab, setTab] = useState<ProfileTab>('posts');

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

  if (profile.isLoading) return <Spinner />;
  if (profile.isError) return <ErrorBox error={profile.error} />;
  if (!profile.data) return null;
  const u = profile.data.user;
  const isMe = viewer?.id === u.id;
  const isFollowing = following ?? u.followedByViewer;

  const toggleFollow = async () => {
    const res = isFollowing ? await api.unfollow(handle) : await api.follow(handle);
    setFollowing(res.following);
    void queryClient.invalidateQueries({ queryKey: ['user', handle] });
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
          <div className="text-[13px] text-x-dim">{t('profile.postCount', { n: u.postCount })}</div>
        </div>
      </div>

      {/* Banner：纯色占位（媒体系统上线后支持自定义图片） */}
      <div className="h-50 w-full bg-x-input" />

      {/* 资料区 */}
      <div className="border-b border-x-border px-4 py-3">
        <div className="-mt-13 flex items-start justify-between">
          <div className="rounded-full border-4 border-x-bg">
            <Avatar handle={u.handle} size={80} />
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
              viewer && (
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
              )
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

        <div className="mt-3 flex gap-5 text-[14px] text-x-dim">
          <Link to={`/u/${handle}/following`} className="hover:underline">
            <b className="text-x-text">{u.followingCount}</b> {t('profile.following')}
          </Link>
          <Link to={`/u/${handle}/followers`} className="hover:underline">
            <b className="text-x-text">{u.followerCount}</b> {t('profile.followers')}
          </Link>
        </div>
      </div>

      {editing && isMe && <EditProfileForm onDone={() => setEditing(false)} />}

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
      {tab === 'media' && <EmptyBox icon={TAB_EMPTY.media.icon} text={t(TAB_EMPTY.media.key)} />}
      {tab === 'posts' && (
        <>
          {posts.isLoading && <Spinner />}
          {posts.isError && <ErrorBox error={posts.error} />}
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
          {activeList.items.map((post) => (
            <PostCard key={post.id} post={post} onDeleted={refreshLists} />
          ))}
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
    </div>
  );
}
