import type { UserSummary } from '@socialsim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { patchAuthorFollow } from '../../api/postCache';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { Composer } from '../../components/Composer';
import { EmptyBox, ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { PostCard } from '../../components/PostCard';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useFormatCount } from '../../i18n/formatCount';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { useI18n } from '../../i18n/I18nContext';

type MainTab = 'foryou' | 'following';
type ForyouMode = 'foryou' | 'global';
type FollowingSort = 'latest' | 'hot';

interface MenuOption<T extends string> {
  value: T;
  label: string;
}

/** Tab 头：点击非活动 Tab 切换；点击活动 Tab 弹出模式下拉菜单 */
function TabWithMenu<T extends string>({
  active,
  label,
  options,
  current,
  onActivate,
  onSelect,
}: {
  active: boolean;
  label: string;
  options: MenuOption<T>[];
  current: T;
  onActivate: () => void;
  onSelect: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex-1">
      <button
        onClick={() => (active ? setOpen((v) => !v) : onActivate())}
        className={`flex h-13.25 w-full cursor-pointer items-center justify-center gap-1.5 text-[15px] transition-colors duration-200 hover:bg-x-hover ${
          active ? 'tab-active' : 'text-x-dim'
        }`}
      >
        {label}
        {active && <i className="ri-arrow-down-s-line text-[16px]" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-1/2 z-30 w-44 -translate-x-1/2 overflow-hidden rounded-xl border border-x-border bg-x-card shadow-lg">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between px-4 py-3 text-[15px] font-bold transition-colors duration-200 hover:bg-x-input"
              >
                {opt.label}
                {current === opt.value && <i className="ri-check-line text-x-blue" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 没关注任何人时的推荐关注列表 */
function FollowSuggestions() {
  const { t } = useI18n();
  const fmt = useFormatCount();
  const queryClient = useQueryClient();
  const suggestions = useQuery({ queryKey: ['suggested-users'], queryFn: api.suggestedUsers });
  const [followed, setFollowed] = useState<Set<number>>(new Set());

  const follow = async (u: UserSummary) => {
    await api.follow(u.handle);
    setFollowed((prev) => new Set(prev).add(u.id));
    patchAuthorFollow(queryClient, u.id, true);
    void queryClient.invalidateQueries({ queryKey: ['timeline'] });
  };

  if (!suggestions.data || suggestions.data.users.length === 0) return null;
  return (
    <div className="border-t border-x-border">
      <h2 className="px-4 pt-4 pb-2 text-[17px] font-extrabold">{t('timeline.suggestions')}</h2>
      {suggestions.data.users.map((u) => (
        <div key={u.id} className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-x-hover">
          <Link to={`/u/${u.handle}`}>
            <Avatar handle={u.handle} avatarUrl={u.avatarUrl} />
          </Link>
          <Link to={`/u/${u.handle}`} className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[15px] font-bold">
              <span className="hover:underline">{u.displayName}</span>
              <VerifiedBadge verified={u.verified} size={14} />
            </div>
            <div className="text-[14px] text-x-dim">
              @{u.handle} · {t('timeline.followerCount', { n: fmt(u.followerCount) })}
            </div>
          </Link>
          <button
            onClick={() => void follow(u)}
            disabled={followed.has(u.id)}
            className="rounded-full bg-x-text px-4 py-1.5 text-[14px] font-bold text-x-bg transition-colors duration-200 hover:opacity-90 disabled:opacity-50"
          >
            {t('profile.follow')}
          </button>
        </div>
      ))}
    </div>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<MainTab>('foryou');
  const [foryouMode, setForyouMode] = useState<ForyouMode>('foryou');
  const [followingSort, setFollowingSort] = useState<FollowingSort>('latest');

  const foryouQuery = usePagedQuery(
    ['timeline', 'foryou', foryouMode],
    foryouMode === 'global' ? api.globalTimeline : api.foryouTimeline,
    { enabled: mainTab === 'foryou' },
  );
  const followingQuery = usePagedQuery(
    ['timeline', 'following', followingSort],
    (cursor) => api.homeTimeline(cursor, followingSort),
    { enabled: mainTab === 'following' && !!user },
  );

  const query = mainTab === 'foryou' ? foryouQuery : followingQuery;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['timeline'] });

  const followingEmpty =
    mainTab === 'following' && followingQuery.isSuccess && followingQuery.items.length === 0;

  return (
    <div>
      <div className="glass-header flex">
        <TabWithMenu<ForyouMode>
          active={mainTab === 'foryou'}
          label={foryouMode === 'global' ? t('timeline.global') : t('timeline.forYou')}
          options={[
            { value: 'foryou', label: t('timeline.forYou') },
            { value: 'global', label: t('timeline.global') },
          ]}
          current={foryouMode}
          onActivate={() => setMainTab('foryou')}
          onSelect={setForyouMode}
        />
        {user && (
          <TabWithMenu<FollowingSort>
            active={mainTab === 'following'}
            label={t('timeline.following')}
            options={[
              { value: 'latest', label: t('timeline.latest') },
              { value: 'hot', label: t('timeline.hot') },
            ]}
            current={followingSort}
            onActivate={() => setMainTab('following')}
            onSelect={setFollowingSort}
          />
        )}
      </div>

      {user && (
        <Composer
          placeholder={t('composer.placeholder')}
          buttonText={t('composer.send')}
          onPosted={refresh}
        />
      )}

      {query.isLoading && <Spinner />}
      {query.isError && <ErrorBox error={query.error} />}
      {query.items.map((item, i) => (
        <PostCard
          key={`${item.type}-${item.post.id}-${i}`}
          post={item.post}
          repostedBy={item.repostedBy}
          onDeleted={refresh}
        />
      ))}
      {followingEmpty ? (
        <>
          <EmptyBox icon="ri-user-add-line" text={t('timeline.noFollowing')} />
          <FollowSuggestions />
        </>
      ) : (
        query.isSuccess &&
        query.items.length === 0 && <EmptyBox icon="ri-chat-3-line" text={t('timeline.empty')} />
      )}
      <LoadMore
        hasNextPage={!!query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </div>
  );
}
