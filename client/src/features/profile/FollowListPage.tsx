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
      <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-gray-800 bg-black/80 p-3 backdrop-blur">
        <button onClick={() => navigate(-1)} className="rounded-full px-2 hover:bg-gray-900">
          ←
        </button>
        <div>
          <div className="font-bold">
            {direction === 'followers' ? t('profile.followers') : t('profile.following')}
          </div>
          <div className="text-sm text-gray-500">@{handle}</div>
        </div>
      </div>
      {query.isLoading && <Spinner />}
      {query.isError && <ErrorBox error={query.error} />}
      {query.items.map((u) => (
        <Link
          key={u.id}
          to={`/u/${u.handle}`}
          className="flex items-center gap-3 border-b border-gray-800 p-4 hover:bg-gray-950"
        >
          <Avatar handle={u.handle} />
          <div>
            <div className="font-bold">{u.displayName}</div>
            <div className="text-sm text-gray-500">@{u.handle}</div>
          </div>
          {u.isBot && (
            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
              {t('profile.bot')}
            </span>
          )}
        </Link>
      ))}
      {query.isSuccess && query.items.length === 0 && <EmptyBox text={t('search.empty')} />}
      <LoadMore
        hasNextPage={!!query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </div>
  );
}
