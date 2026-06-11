import type { NotificationView } from '@socialsim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { Avatar } from '../../components/Avatar';
import { EmptyBox, ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { TimeAgo } from '../../components/TimeAgo';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useI18n } from '../../i18n/I18nContext';

const ICONS: Record<NotificationView['type'], string> = {
  reply: '💬',
  quote: '❝',
  like: '❤️',
  repost: '🔁',
  follow: '👤',
};

export function NotificationsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const query = usePagedQuery(['notifications'], (cursor) => api.notifications(cursor));

  const markAll = async () => {
    await api.markAllRead();
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
  };

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-black/80 p-3 backdrop-blur">
        <span className="font-bold">{t('notif.title')}</span>
        <button
          onClick={() => void markAll()}
          className="rounded-full px-3 py-1 text-sm text-sky-500 hover:bg-gray-900"
        >
          {t('notif.markAllRead')}
        </button>
      </div>
      {query.isLoading && <Spinner />}
      {query.isError && <ErrorBox error={query.error} />}
      {query.items.map((n) => {
        const text = t(`notif.${n.type}`);
        const inner = (
          <div className={`flex items-center gap-3 border-b border-gray-800 p-4 hover:bg-gray-950 ${n.read ? '' : 'bg-sky-950/20'}`}>
            <span className="text-xl">{ICONS[n.type]}</span>
            <Avatar handle={n.actor.handle} size={32} />
            <div className="min-w-0 flex-1">
              <span className="font-bold">{n.actor.displayName}</span>{' '}
              <span className="text-gray-400">{text}</span>
            </div>
            <TimeAgo at={n.createdAt} />
          </div>
        );
        return n.postId !== null ? (
          <Link key={n.id} to={`/post/${n.postId}`}>
            {inner}
          </Link>
        ) : (
          <Link key={n.id} to={`/u/${n.actor.handle}`}>
            {inner}
          </Link>
        );
      })}
      {query.isSuccess && query.items.length === 0 && <EmptyBox text={t('notif.empty')} />}
      <LoadMore
        hasNextPage={!!query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </div>
  );
}
