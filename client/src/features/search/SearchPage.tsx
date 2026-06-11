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
    `flex-1 cursor-pointer p-3 text-center text-[15px] transition-colors duration-200 hover:bg-x-hover ${
      active ? 'tab-active' : 'text-x-dim'
    }`;

  const active = tab === 'posts' ? posts : users;

  return (
    <div>
      <div className="glass-header">
        <form onSubmit={submit} className="relative p-3">
          <i className="ri-search-line absolute top-1/2 left-7 -translate-y-1/2 text-[14px] text-x-dim" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('search.placeholder')}
            autoFocus
            className="w-full rounded-full border border-transparent bg-x-input py-2.5 pr-4 pl-11 text-[15px] outline-none placeholder:text-x-dim focus:border-x-blue focus:bg-x-bg"
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

      {q.length === 0 && <EmptyBox icon="ri-search-line" text={t('search.prompt')} />}
      {active.isLoading && q.length > 0 && <Spinner />}
      {active.isError && <ErrorBox error={active.error} />}

      {tab === 'posts' &&
        posts.items.map((post) => <PostCard key={post.id} post={post} />)}
      {tab === 'users' &&
        users.items.map((u) => (
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
          </Link>
        ))}

      {q.length > 0 && active.isSuccess && active.items.length === 0 && (
        <EmptyBox icon="ri-search-line" text={t('search.empty')} />
      )}
      <LoadMore
        hasNextPage={!!active.hasNextPage}
        isFetching={active.isFetchingNextPage}
        onClick={() => void active.fetchNextPage()}
      />
    </div>
  );
}
