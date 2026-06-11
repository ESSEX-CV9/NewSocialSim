import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Composer } from '../../components/Composer';
import { ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { PostCard } from '../../components/PostCard';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useI18n } from '../../i18n/I18nContext';

export function PostDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const post = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.getPost(id),
    enabled: Number.isFinite(id),
  });
  const replies = usePagedQuery(['replies', id], (cursor) => api.getReplies(id, cursor), {
    enabled: Number.isFinite(id),
  });

  if (post.isLoading) return <Spinner />;
  if (post.isError) return <ErrorBox error={post.error} />;
  if (!post.data) return null;
  const view = post.data.post;

  return (
    <div>
      <div className="glass-header flex items-center gap-5 px-3 py-2">
        <button
          onClick={() => navigate(-1)}
          className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
        >
          <i className="fas fa-arrow-left text-[16px]" />
        </button>
        <span className="text-[17px] font-bold">{t('nav.home')}</span>
      </div>

      {view.replyToId !== null && (
        <Link
          to={`/post/${view.replyToId}`}
          className="flex items-center gap-2 border-b border-x-border p-3 text-sm text-x-blue transition-colors duration-200 hover:bg-x-hover"
        >
          <i className="fas fa-arrow-up text-[12px]" /> {t('post.viewParent')}
        </Link>
      )}

      <PostCard post={view} large onDeleted={() => navigate('/')} />

      {user && !view.deleted && (
        <Composer
          replyToId={id}
          placeholder={t('composer.replyPlaceholder')}
          buttonText={t('composer.reply')}
          onPosted={() => {
            void queryClient.invalidateQueries({ queryKey: ['replies', id] });
            void queryClient.invalidateQueries({ queryKey: ['post', id] });
          }}
        />
      )}

      {replies.items.map((reply) => (
        <PostCard key={reply.id} post={reply} />
      ))}
      <LoadMore
        hasNextPage={!!replies.hasNextPage}
        isFetching={replies.isFetchingNextPage}
        onClick={() => void replies.fetchNextPage()}
      />
    </div>
  );
}
