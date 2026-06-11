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
    <p className="text-[15px] leading-normal wrap-break-word whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith('#') ? (
          <Link
            key={i}
            to={`/search?q=${encodeURIComponent(part)}&type=posts`}
            onClick={(e) => e.stopPropagation()}
            className="text-x-blue hover:underline"
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
    <div className="rounded-xl border border-x-border bg-x-card p-4 text-[15px] text-x-dim">
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
      className="mt-2 cursor-pointer rounded-xl border border-x-border p-3 transition-colors duration-200 hover:bg-x-hover"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[15px]">
        <Avatar handle={quoted.author.handle} size={20} />
        <span className="font-bold">{quoted.author.displayName}</span>
        <span className="text-x-dim">@{quoted.author.handle}</span>
        <span className="text-x-dim">·</span>
        <TimeAgo at={quoted.createdAt} />
      </div>
      <PostContent content={quoted.content} />
    </div>
  );
}

/** 互动按钮：FA 图标 + 计数，hover 时图标出现同色 10% 圆形气泡 */
function ActionButton({
  icon,
  count,
  label,
  color,
  active,
  onClick,
}: {
  icon: string;
  count?: number | undefined;
  label?: string | undefined;
  color: 'blue' | 'green' | 'pink' | 'red';
  active?: boolean | undefined;
  onClick?: ((e: MouseEvent) => void) | undefined;
}) {
  const colorClass = {
    blue: { text: 'hover:text-x-blue', bubble: 'group-hover/act:bg-x-blue/10', on: 'text-x-blue' },
    green: {
      text: 'hover:text-x-green',
      bubble: 'group-hover/act:bg-x-green/10',
      on: 'text-x-green',
    },
    pink: { text: 'hover:text-x-pink', bubble: 'group-hover/act:bg-x-pink/10', on: 'text-x-pink' },
    red: { text: 'hover:text-x-red', bubble: 'group-hover/act:bg-x-red/10', on: 'text-x-red' },
  }[color];

  return (
    <button
      onClick={onClick}
      className={`group/act flex items-center text-[13px] transition-colors duration-200 ${
        active ? colorClass.on : 'text-x-dim'
      } ${colorClass.text}`}
    >
      <span
        className={`-m-2 flex size-8.5 items-center justify-center rounded-full transition-colors duration-200 ${colorClass.bubble}`}
      >
        <i className={`${icon} text-[16px]`} />
      </span>
      {count !== undefined && count > 0 && <span className="ml-2.5">{count}</span>}
      {label && <span className="ml-2.5">{label}</span>}
    </button>
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
      <div className="border-b border-x-border p-4">
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

  return (
    <article
      onClick={() => !large && navigate(`/post/${post.id}`)}
      className={`border-b border-x-border px-4 py-3 ${
        large ? '' : 'cursor-pointer transition-colors duration-200 hover:bg-x-hover'
      }`}
    >
      {repostedBy && (
        <div className="mb-1 ml-8 flex items-center gap-2 text-[13px] font-bold text-x-dim">
          <i className="fas fa-retweet" />
          {t('timeline.repostedBy', { name: repostedBy.displayName })}
        </div>
      )}
      <div className="flex gap-3">
        <Link to={`/u/${post.author.handle}`} onClick={stop} className="self-start">
          <Avatar handle={post.author.handle} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1 text-[15px]">
            <Link
              to={`/u/${post.author.handle}`}
              onClick={stop}
              className="font-bold hover:underline"
            >
              {post.author.displayName}
            </Link>
            {post.author.isBot && (
              <span className="ml-0.5 rounded bg-x-input px-1 text-xs text-x-dim">
                {t('profile.bot')}
              </span>
            )}
            <span className="ml-0.5 text-x-dim">@{post.author.handle}</span>
            <span className="text-x-dim">·</span>
            <TimeAgo at={post.createdAt} />
          </div>
          <div className={large ? 'mt-2 text-xl' : 'mt-0.5'}>
            <PostContent content={post.content} />
          </div>
          {post.quoted && <QuotedCard quoted={post.quoted} />}
          <div className="mt-3 flex max-w-106 items-center justify-between">
            <ActionButton icon="far fa-comment" count={post.replyCount} color="blue" />
            <ActionButton
              icon="fas fa-retweet"
              count={repostCount}
              color="green"
              active={reposted}
              onClick={(e) => void toggleRepost(e)}
            />
            <ActionButton
              icon="fas fa-quote-left"
              color="blue"
              onClick={(e) => {
                stop(e);
                if (!user) return navigate('/login');
                setQuoteOpen(true);
              }}
            />
            <ActionButton
              icon={liked ? 'fas fa-heart' : 'far fa-heart'}
              count={likeCount}
              color="pink"
              active={liked}
              onClick={(e) => void toggleLike(e)}
            />
            {user?.id === post.authorId ? (
              <ActionButton icon="fas fa-trash-can" color="red" onClick={(e) => void remove(e)} />
            ) : (
              <span className="size-8.5" />
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
          <div
            onClick={stop}
            className="w-full max-w-xl rounded-2xl border border-x-border bg-x-bg"
          >
            <div className="flex items-center p-2">
              <button
                onClick={(e) => {
                  stop(e);
                  setQuoteOpen(false);
                }}
                className="flex size-9 items-center justify-center rounded-full text-x-text transition-colors duration-200 hover:bg-x-input"
              >
                <i className="fas fa-xmark text-[18px]" />
              </button>
            </div>
            <Composer
              quoteOfId={post.id}
              placeholder={t('composer.quotePlaceholder')}
              buttonText={t('composer.send')}
              autoFocus
              bordered={false}
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
