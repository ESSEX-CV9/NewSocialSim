import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints';
import { EmptyBox, ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { PostCard } from '../../components/PostCard';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useI18n } from '../../i18n/I18nContext';

export function BookmarksPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const query = usePagedQuery(['bookmarks'], (cursor) => api.bookmarks(cursor));

  return (
    <div>
      <div className="glass-header px-4 py-3 text-[17px] font-bold">{t('bookmarks.title')}</div>
      {query.isLoading && <Spinner />}
      {query.isError && <ErrorBox error={query.error} />}
      {query.items.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onDeleted={() => void queryClient.invalidateQueries({ queryKey: ['bookmarks'] })}
        />
      ))}
      {query.isSuccess && query.items.length === 0 && (
        <EmptyBox icon="ri-bookmark-line" text={t('bookmarks.empty')} />
      )}
      <LoadMore
        hasNextPage={!!query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </div>
  );
}
