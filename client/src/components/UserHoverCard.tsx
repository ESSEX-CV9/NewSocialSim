import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserProfile } from '@socialsim/shared';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/endpoints';
import { patchAuthorFollow } from '../api/postCache';
import { useAuth } from '../auth/AuthContext';
import { useFormatCount } from '../i18n/formatCount';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

/**
 * 用户悬浮卡：包住头像/昵称等锚点，悬停 400ms 弹出个人简介概览（X 同款）。
 * 资料数据走 ['user', handle] 查询缓存（与资料页共享），打开时才拉取。
 */
export function UserHoverCard({ handle, children }: { handle: string; children: ReactNode }) {
  const { user: viewer } = useAuth();
  const { t } = useI18n();
  const fmt = useFormatCount();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profile = useQuery({
    queryKey: ['user', handle],
    queryFn: () => api.getUser(handle),
    enabled: open && handle.length > 0,
  });
  const u = profile.data?.user;

  const toggleFollow = async () => {
    if (!u) return;
    const res = u.followedByViewer ? await api.unfollow(handle) : await api.follow(handle);
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

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        if (openTimer.current) clearTimeout(openTimer.current);
        openTimer.current = setTimeout(() => setOpen(true), 400);
      }}
      onMouseLeave={() => {
        if (openTimer.current) clearTimeout(openTimer.current);
        closeTimer.current = setTimeout(() => setOpen(false), 300);
      }}
    >
      {children}
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full left-0 z-40 mt-1 w-72 cursor-default rounded-2xl border border-x-border bg-x-bg p-4 shadow-lg"
        >
          {u ? (
            <>
              <div className="flex items-start justify-between">
                <Link to={`/u/${u.handle}`}>
                  <Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={56} />
                </Link>
                {viewer && viewer.id !== u.id && !u.blockedByViewer && (
                  <button
                    onClick={() => void toggleFollow()}
                    className={`rounded-full px-4 py-1 text-[13px] font-bold transition-colors duration-200 ${
                      u.followedByViewer
                        ? 'border border-x-dim text-x-text hover:border-x-red/60 hover:bg-x-red/10 hover:text-x-red'
                        : 'bg-x-text text-x-bg hover:opacity-90'
                    }`}
                  >
                    {u.followedByViewer ? t('profile.unfollow') : t('profile.follow')}
                  </button>
                )}
              </div>
              <Link
                to={`/u/${u.handle}`}
                className="mt-2 flex items-center gap-1 text-[16px] font-extrabold hover:underline"
              >
                <span className="truncate">{u.displayName}</span>
                <VerifiedBadge verified={u.verified} size={16} />
              </Link>
              <div className="text-[14px] text-x-dim">@{u.handle}</div>
              {u.bio && (
                <p className="mt-2 line-clamp-3 text-[14px] whitespace-pre-wrap">{u.bio}</p>
              )}
              <div className="mt-2 flex gap-4 text-[13px] text-x-dim">
                <Link to={`/u/${u.handle}/following`} className="hover:underline">
                  <b className="text-x-text">{fmt(u.followingCount)}</b> {t('profile.following')}
                </Link>
                <Link to={`/u/${u.handle}/followers`} className="hover:underline">
                  <b className="text-x-text">{fmt(u.followerCount)}</b> {t('profile.followers')}
                </Link>
              </div>
            </>
          ) : (
            <div className="flex justify-center py-6">
              <div className="spinner" />
            </div>
          )}
        </div>
      )}
    </span>
  );
}
