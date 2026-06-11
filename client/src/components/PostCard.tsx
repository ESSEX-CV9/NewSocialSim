import type { PostView, UserSummary } from '@socialsim/shared';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { TimeAgo } from './TimeAgo';

/** 帖子正文：#话题 转为搜索链接 */
function PostContent({ content }: { content: string }) {
  const parts = content.split(/(#[^\s#]+)/g);
  return (
    <p className="break-words whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith('#') ? (
          <Link
            key={i}
            to={`/search?q=${encodeURIComponent(part)}&type=posts`}
            onClick={(e) => e.stopPropagation()}
            className="text-sky-500 hover:underline"
          >
            {part}
          </Link>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function Tombstone({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-gray-800 p-4 text-gray-500">
      {t('post.deleted')}
      {children}
    </div>
  );
}

/** 被引用帖子的嵌入卡片 */
function QuotedCard({ quoted }: { quoted: PostView }) {
  const navigate = useNavigate();
  if (quoted.deleted) return <Tombstone />;
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/post/${quoted.id}`);
      }}
      className="mt-2 cursor-pointer rounded-xl border border-gray-800 p-3 hover:bg-gray-950"
    >
      <div className="mb-1 flex items-center gap-2 text-sm">
        <Avatar handle={quoted.author.handle} size={20} />
        <span className="font-bold">{quoted.author.displayName}</span>
        <span className="text-gray-500">@{quoted.author.handle}</span>
        <TimeAgo at={quoted.createdAt} />
      </div>
      <PostContent content={quoted.content} />
    </div>
  );
}

interface PostCardProps {
  post: PostView;
  repostedBy?: UserSummary | null;
  /** 详情页大字号模式 */
  large?: boolean;
  onDeleted?: (id: number) => void;
}

export function PostCard({ post, repostedBy, large, onDeleted }: PostCardProps) {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [liked, setLiked] = useState(post.likedByViewer);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reposted, setReposted] = useState(post.repostedByViewer);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [gone, setGone] = useState(false);

  if (gone) return null;
  if (post.deleted) {
    return (
      <div className="border-b border-gray-800 p-4">
        <Tombstone />
      </div>
    );
  }

  const stop = (e: MouseEvent) => e.stopPropagation();

  const toggleLike = async (e: MouseEvent) => {
    stop(e);
    if (!user) return navigate('/login');
    const res = liked ? await api.unlike(post.id) : await api.like(post.id);
    setLiked(res.active);
    setLikeCount(res.count);
  };

  const toggleRepost = async (e: MouseEvent) => {
    stop(e);
    if (!user) return navigate('/login');
    const res = reposted ? await api.unrepost(post.id) : await api.repost(post.id);
    setReposted(res.active);
    setRepostCount(res.count);
  };

  const remove = async (e: MouseEvent) => {
    stop(e);
    if (!window.confirm(t('post.deleteConfirm'))) return;
    await api.deletePost(post.id);
    setGone(true);
    onDeleted?.(post.id);
  };

  const actionClass =
    'flex items-center gap-1.5 text-sm text-gray-500 transition-colors';

  return (
    <article
      onClick={() => !large && navigate(`/post/${post.id}`)}
      className={`border-b border-gray-800 p-4 ${large ? '' : 'cursor-pointer hover:bg-gray-950/60'}`}
    >
      {repostedBy && (
        <div className="mb-1 ml-8 text-sm text-gray-500">
          {t('timeline.repostedBy', { name: repostedBy.displayName })}
        </div>
      )}
      <div className="flex gap-3">
        <Link to={`/u/${post.author.handle}`} onClick={stop}>
          <Avatar handle={post.author.handle} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <Link
              to={`/u/${post.author.handle}`}
              onClick={stop}
              className="font-bold hover:underline"
            >
              {post.author.displayName}
            </Link>
            {post.author.isBot && (
              <span className="rounded bg-gray-800 px-1 text-xs text-gray-400">
                {t('profile.bot')}
              </span>
            )}
            <span className="text-gray-500">@{post.author.handle}</span>
            <span className="text-gray-600">·</span>
            <TimeAgo at={post.createdAt} />
          </div>
          <div className={large ? 'mt-2 text-xl' : 'mt-0.5'}>
            <PostContent content={post.content} />
          </div>
          {post.quoted && <QuotedCard quoted={post.quoted} />}
          <div className="mt-3 flex max-w-md items-center justify-between">
            <span className={`${actionClass} hover:text-sky-500`}>
              <span>💬</span>
              {post.replyCount > 0 && post.replyCount}
            </span>
            <button
              onClick={(e) => void toggleRepost(e)}
              className={`${actionClass} hover:text-green-500 ${reposted ? 'text-green-500' : ''}`}
            >
              <span>🔁</span>
              {repostCount > 0 && repostCount}
            </button>
            <button
              onClick={(e) => {
                stop(e);
                if (!user) return navigate('/login');
                setQuoteOpen(true);
              }}
              className={`${actionClass} hover:text-sky-500`}
            >
              <span>❝</span>
              {t('post.quote')}
            </button>
            <button
              onClick={(e) => void toggleLike(e)}
              className={`${actionClass} hover:text-pink-500 ${liked ? 'text-pink-500' : ''}`}
            >
              <span>{liked ? '❤️' : '🤍'}</span>
              {likeCount > 0 && likeCount}
            </button>
            {user?.id === post.authorId && (
              <button onClick={(e) => void remove(e)} className={`${actionClass} hover:text-red-500`}>
                🗑
              </button>
            )}
          </div>
        </div>
      </div>

      {quoteOpen && (
        <div
          onClick={(e) => {
            stop(e);
            setQuoteOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20"
        >
          <div onClick={stop} className="w-full max-w-xl rounded-2xl border border-gray-800 bg-black">
            <Composer
              quoteOfId={post.id}
              placeholder={t('composer.quotePlaceholder')}
              buttonText={t('composer.send')}
              autoFocus
              onPosted={(p) => {
                setQuoteOpen(false);
                navigate(`/post/${p.id}`);
              }}
            />
            <div className="px-4 pb-4">
              <QuotedCard quoted={post} />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
