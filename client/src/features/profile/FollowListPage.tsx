import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { Avatar } from '../../components/Avatar';
import { EmptyBox, ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useI18n } from '../../i18n/I18nContext';

export function FollowListPage({ direction }: { direction: 'followers' | 'following' }) {
  const { handle = '' } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();

  const query = usePagedQuery(
    ['follow-list', handle, direction],
    (cursor) =>
      direction === 'followers' ? api.followers(handle, cursor) : api.following(handle, cursor),
    { enabled: handle.length > 0 },
  );

  return (
    <div>
      <div className="glass-header flex items-center gap-5 px-3 py-2">
        <button
          onClick={() => navigate(-1)}
          className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
        >
          <i className="fas fa-arrow-left text-[16px]" />
        </button>
        <div>
          <div className="text-[17px] font-bold">
            {direction === 'followers' ? t('profile.followers') : t('profile.following')}
          </div>
          <div className="text-[13px] text-x-dim">@{handle}</div>
        </div>
      </div>
      {query.isLoading && <Spinner />}
      {query.isError && <ErrorBox error={query.error} />}
      {query.items.map((u) => (
        <Link
          key={u.id}
          to={`/u/${u.handle}`}
          className="flex items-center gap-3 border-b border-x-border px-4 py-3 transition-colors duration-200 hover:bg-x-hover"
        >
          <Avatar handle={u.handle} />
          <div>
            <div className="text-[15px] font-bold">{u.displayName}</div>
            <div className="text-[14px] text-x-dim">@{u.handle}</div>
          </div>
          {u.isBot && (
            <span className="rounded bg-x-input px-1.5 py-0.5 text-xs text-x-dim">
              <i className="fas fa-robot mr-1" />
              {t('profile.bot')}
            </span>
          )}
        </Link>
      ))}
      {query.isSuccess && query.items.length === 0 && (
        <EmptyBox icon="far fa-user" text={t('search.empty')} />
      )}
      <LoadMore
        hasNextPage={!!query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </div>
  );
}
