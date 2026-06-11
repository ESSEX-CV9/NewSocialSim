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

const TYPE_ICONS: Record<NotificationView['type'], { icon: string; color: string }> = {
  reply: { icon: 'far fa-comment', color: 'text-x-blue' },
  quote: { icon: 'fas fa-quote-left', color: 'text-x-blue' },
  like: { icon: 'fas fa-heart', color: 'text-x-pink' },
  repost: { icon: 'fas fa-retweet', color: 'text-x-green' },
  follow: { icon: 'fas fa-user-plus', color: 'text-x-blue' },
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
      <div className="glass-header flex items-center justify-between px-4 py-2.5">
        <span className="text-[17px] font-bold">{t('notif.title')}</span>
        <button
          onClick={() => void markAll()}
          className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-x-blue transition-colors duration-200 hover:bg-x-input"
        >
          <i className="fas fa-check-double" />
          {t('notif.markAllRead')}
        </button>
      </div>
      {query.isLoading && <Spinner />}
      {query.isError && <ErrorBox error={query.error} />}
      {query.items.map((n) => {
        const type = TYPE_ICONS[n.type];
        const inner = (
          <div
            className={`flex items-center gap-3 border-b border-x-border px-4 py-3 transition-colors duration-200 hover:bg-x-hover ${
              n.read ? '' : 'border-l-2 border-l-x-blue bg-x-blue/5'
            }`}
          >
            <i className={`${type.icon} ${type.color} w-6 text-center text-[20px]`} />
            <Avatar handle={n.actor.handle} size={32} />
            <div className="min-w-0 flex-1 text-[15px]">
              <span className="font-bold">{n.actor.displayName}</span>{' '}
              <span className="text-x-dim">{t(`notif.${n.type}`)}</span>
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
      {query.isSuccess && query.items.length === 0 && (
        <EmptyBox icon="far fa-bell" text={t('notif.empty')} />
      )}
      <LoadMore
        hasNextPage={!!query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </div>
  );
}
