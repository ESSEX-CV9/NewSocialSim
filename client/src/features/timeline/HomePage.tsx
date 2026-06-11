import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Composer } from '../../components/Composer';
import { EmptyBox, ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { PostCard } from '../../components/PostCard';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useI18n } from '../../i18n/I18nContext';

type Tab = 'following' | 'global';

export function HomePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>(user ? 'following' : 'global');

  const query = usePagedQuery(
    ['timeline', tab],
    tab === 'following' ? api.homeTimeline : api.globalTimeline,
    { enabled: tab === 'global' || !!user },
  );

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['timeline'] });

  const tabClass = (active: boolean) =>
    `flex-1 cursor-pointer p-4 text-center font-bold hover:bg-gray-950 ${
      active ? 'border-b-2 border-sky-500 text-gray-100' : 'text-gray-500'
    }`;

  return (
    <div>
      <div className="sticky top-0 z-10 flex border-b border-gray-800 bg-black/80 backdrop-blur">
        {user && (
          <button className={tabClass(tab === 'following')} onClick={() => setTab('following')}>
            {t('timeline.following')}
          </button>
        )}
        <button className={tabClass(tab === 'global')} onClick={() => setTab('global')}>
          {t('timeline.global')}
        </button>
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
      {query.isSuccess && query.items.length === 0 && <EmptyBox text={t('timeline.empty')} />}
      <LoadMore
        hasNextPage={!!query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </div>
  );
}
