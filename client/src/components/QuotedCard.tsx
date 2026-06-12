import type { PostView } from '@socialsim/shared';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';
import { MediaGrid } from './MediaGrid';
import { PostContent } from './PostContent';
import { TimeAgo } from './TimeAgo';
import { UserHoverCard } from './UserHoverCard';
import { VerifiedBadge } from './VerifiedBadge';

export function Tombstone({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border-2 border-x-border bg-x-card p-4 text-[15px] text-x-dim">
      {t('post.deleted')}
      {children}
    </div>
  );
}

/** 被引用帖子的嵌入卡片 */
export function QuotedCard({ quoted }: { quoted: PostView }) {
  const navigate = useNavigate();
  if (quoted.deleted) return <Tombstone />;
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/post/${quoted.id}`);
      }}
      className="mt-2 cursor-pointer rounded-xl border-2 border-x-border p-3 transition-colors duration-200 hover:bg-x-hover"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[15px]">
        <UserHoverCard handle={quoted.author.handle}>
          <span className="flex items-center gap-1.5">
            <Avatar handle={quoted.author.handle} avatarUrl={quoted.author.avatarUrl} size={20} />
            <span className="font-bold">{quoted.author.displayName}</span>
            <VerifiedBadge verified={quoted.author.verified} />
          </span>
        </UserHoverCard>
        <span className="text-x-dim">@{quoted.author.handle}</span>
        <span className="text-x-dim">·</span>
        <TimeAgo at={quoted.createdAt} />
      </div>
      <PostContent content={quoted.content} />
      {quoted.media.length > 0 && <MediaGrid media={quoted.media} compact postId={quoted.id} />}
    </div>
  );
}
