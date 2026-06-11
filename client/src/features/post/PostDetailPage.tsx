import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
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
  const [composerOpen, setComposerOpen] = useState(false);

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
          <i className="ri-arrow-left-line text-[16px]" />
        </button>
        <span className="text-[17px] font-bold">{t('nav.home')}</span>
      </div>

      {view.replyToId !== null && (
        <Link
          to={`/post/${view.replyToId}`}
          className="flex items-center gap-2 border-b border-x-border p-3 text-sm text-x-blue transition-colors duration-200 hover:bg-x-hover"
        >
          <i className="ri-arrow-up-line text-[12px]" /> {t('post.viewParent')}
        </Link>
      )}

      <PostCard post={view} large onDeleted={() => navigate('/')} />

      {/* 回复区：默认收起为窄条，点击展开为完整回复框（与 X 一致） */}
      {user &&
        !view.deleted &&
        (composerOpen ? (
          <div className="border-b border-x-border">
            <div className="px-4 pt-3 pl-17 text-[14px] text-x-dim">
              {t('post.replyingTo', { handle: view.author.handle })}
            </div>
            <Composer
              replyToId={id}
              placeholder={t('composer.replyPlaceholder')}
              buttonText={t('composer.reply')}
              autoFocus
              bordered={false}
              onPosted={() => {
                setComposerOpen(false);
                void queryClient.invalidateQueries({ queryKey: ['replies', id] });
                void queryClient.invalidateQueries({ queryKey: ['post', id] });
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setComposerOpen(true)}
            className="flex w-full cursor-text items-center gap-3 border-b border-x-border px-4 py-2.5 transition-colors duration-200 hover:bg-x-hover"
          >
            <Avatar handle={user.handle} avatarUrl={user.avatarUrl} size={40} />
            <span className="flex-1 text-left text-[17px] text-x-dim">
              {t('composer.replyPlaceholder')}
            </span>
            <span className="rounded-full bg-x-blue px-4 py-1.5 text-[15px] font-bold text-white opacity-50">
              {t('composer.reply')}
            </span>
          </button>
        ))}

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
