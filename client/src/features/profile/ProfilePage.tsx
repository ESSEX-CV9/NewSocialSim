import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { PostCard } from '../../components/PostCard';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useI18n } from '../../i18n/I18nContext';
import { inputClass } from '../auth/LoginPage';

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

export function ProfilePage() {
  const { handle = '' } = useParams();
  const { user: viewer } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(null);

  const profile = useQuery({
    queryKey: ['user', handle],
    queryFn: () => api.getUser(handle),
    enabled: handle.length > 0,
  });
  const posts = usePagedQuery(['user-posts', handle], (cursor) => api.getUserPosts(handle, cursor), {
    enabled: handle.length > 0,
  });

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

  return (
    <div>
      <div className="border-b border-x-border p-4">
        <div className="flex items-start justify-between">
          <Avatar handle={u.handle} size={80} />
          {isMe ? (
            <button
              onClick={() => setEditing((v) => !v)}
              className="rounded-full border border-x-dim px-4 py-1.5 text-[15px] font-bold transition-colors duration-200 hover:bg-x-input"
            >
              {t('profile.editProfile')}
            </button>
          ) : (
            viewer && (
              <button
                onClick={() => void toggleFollow()}
                className={`rounded-full px-4 py-1.5 text-[15px] font-bold transition-colors duration-200 ${
                  isFollowing
                    ? 'border border-x-dim text-x-text hover:border-x-red/60 hover:bg-x-red/10 hover:text-x-red'
                    : 'bg-x-text text-black hover:bg-white'
                }`}
              >
                {isFollowing ? t('profile.unfollow') : t('profile.follow')}
              </button>
            )
          )}
        </div>
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold">{u.displayName}</h1>
            {u.isBot && (
              <span className="rounded bg-x-input px-1.5 py-0.5 text-xs text-x-dim">
                <i className="fas fa-robot mr-1" />
                {t('profile.bot')}
              </span>
            )}
          </div>
          <div className="text-[15px] text-x-dim">@{u.handle}</div>
          {u.bio && <p className="mt-2 text-[15px] whitespace-pre-wrap">{u.bio}</p>}
          <div className="mt-3 flex gap-4 text-[14px] text-x-dim">
            <Link to={`/u/${handle}/following`} className="hover:underline">
              <b className="text-x-text">{u.followingCount}</b> {t('profile.following')}
            </Link>
            <Link to={`/u/${handle}/followers`} className="hover:underline">
              <b className="text-x-text">{u.followerCount}</b> {t('profile.followers')}
            </Link>
            <span>
              <b className="text-x-text">{u.postCount}</b> {t('profile.posts')}
            </span>
          </div>
        </div>
      </div>

      {editing && isMe && <EditProfileForm onDone={() => setEditing(false)} />}

      {posts.items.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onDeleted={() => void queryClient.invalidateQueries({ queryKey: ['user-posts', handle] })}
        />
      ))}
      <LoadMore
        hasNextPage={!!posts.hasNextPage}
        isFetching={posts.isFetchingNextPage}
        onClick={() => void posts.fetchNextPage()}
      />
    </div>
  );
}
