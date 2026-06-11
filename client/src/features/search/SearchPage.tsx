import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { Avatar } from '../../components/Avatar';
import { EmptyBox, ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { PostCard } from '../../components/PostCard';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useI18n } from '../../i18n/I18nContext';

type Tab = 'posts' | 'users';

export function SearchPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const tab: Tab = params.get('type') === 'users' ? 'users' : 'posts';
  const [input, setInput] = useState(q);

  const posts = usePagedQuery(['search-posts', q], (cursor) => api.searchPosts(q, cursor), {
    enabled: q.length > 0 && tab === 'posts',
  });
  const users = usePagedQuery(['search-users', q], (cursor) => api.searchUsers(q, cursor), {
    enabled: q.length > 0 && tab === 'users',
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim()) setParams({ q: input.trim(), type: tab });
  };

  const tabClass = (active: boolean) =>
    `flex-1 cursor-pointer p-3 text-center font-bold hover:bg-gray-950 ${
      active ? 'border-b-2 border-sky-500 text-gray-100' : 'text-gray-500'
    }`;

  const active = tab === 'posts' ? posts : users;

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-gray-800 bg-black/80 backdrop-blur">
        <form onSubmit={submit} className="p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('search.placeholder')}
            autoFocus
            className="w-full rounded-full border border-gray-800 bg-gray-950 px-4 py-2 outline-none focus:border-sky-500"
          />
        </form>
        <div className="flex">
          <button className={tabClass(tab === 'posts')} onClick={() => setParams({ q, type: 'posts' })}>
            {t('search.posts')}
          </button>
          <button className={tabClass(tab === 'users')} onClick={() => setParams({ q, type: 'users' })}>
            {t('search.users')}
          </button>
        </div>
      </div>

      {q.length === 0 && <EmptyBox text={t('search.prompt')} />}
      {active.isLoading && q.length > 0 && <Spinner />}
      {active.isError && <ErrorBox error={active.error} />}

      {tab === 'posts' &&
        posts.items.map((post) => <PostCard key={post.id} post={post} />)}
      {tab === 'users' &&
        users.items.map((u) => (
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
          </Link>
        ))}

      {q.length > 0 && active.isSuccess && active.items.length === 0 && (
        <EmptyBox text={t('search.empty')} />
      )}
      <LoadMore
        hasNextPage={!!active.hasNextPage}
        isFetching={active.isFetchingNextPage}
        onClick={() => void active.fetchNextPage()}
      />
    </div>
  );
}
