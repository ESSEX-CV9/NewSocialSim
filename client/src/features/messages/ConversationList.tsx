import type { ConversationView } from '@socialsim/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { LoadMore } from '../../components/LoadMore';
import { TimeAgo } from '../../components/TimeAgo';
import { usePagedQuery } from '../../components/usePagedQuery';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { useI18n } from '../../i18n/I18nContext';

function ConversationListItem({
  conversation,
  active,
  onClick,
}: {
  conversation: ConversationView;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const other = conversation.otherParticipant;
  const last = conversation.lastMessage;
  const unread = conversation.unreadCount > 0;

  let preview = '';
  if (last) {
    if (last.deleted) preview = t('dm.deletedMessage');
    else {
      const text = last.content || (last.hasMedia ? t('dm.mediaPreview') : '');
      preview = last.senderId === user?.id ? `${t('dm.you')}${text}` : text;
    }
  }

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-x-hover ${
        active ? 'border-r-2 border-x-blue bg-x-input' : ''
      }`}
    >
      <Avatar handle={other.handle} avatarUrl={other.avatarUrl} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[15px]">
          <span className="truncate font-bold">{other.displayName}</span>
          <VerifiedBadge verified={other.verified} size={14} />
          <span className="truncate text-x-dim">@{other.handle}</span>
          {last && (
            <>
              <span className="text-x-dim">·</span>
              <span className="shrink-0 text-[13px]">
                <TimeAgo at={last.createdAt} />
              </span>
            </>
          )}
        </div>
        <div
          className={`truncate text-[14px] ${unread ? 'font-semibold text-x-text' : 'text-x-dim'}`}
        >
          {preview}
        </div>
      </div>
      {unread && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-x-blue" />}
    </button>
  );
}

/** 会话列表栏：标题 + 新建按钮 + 收件箱/请求 Tab + 列表 */
export function ConversationList({
  activeId,
  onNewMessage,
}: {
  activeId: number | null;
  onNewMessage: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'inbox' | 'requests'>('inbox');

  const unread = useQuery({ queryKey: ['dm-unread'], queryFn: api.dmUnreadCount });
  const requestCount = unread.data?.requestCount ?? 0;

  const query = usePagedQuery(
    ['dm-conversations', filter],
    (cursor) => api.dmConversations(filter, cursor),
    { refetchOnMount: 'always', refetchInterval: 30_000 },
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-xl font-bold">{t('dm.title')}</h1>
        <button
          aria-label={t('dm.newMessage')}
          title={t('dm.newMessage')}
          onClick={onNewMessage}
          className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
        >
          <i className="ri-mail-add-line text-[19px]" />
        </button>
      </div>
      <div className="flex border-b border-x-border">
        {(['inbox', 'requests'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className="flex-1 py-3 text-center text-[15px] transition-colors duration-200 hover:bg-x-hover"
          >
            <span
              className={`relative inline-block pb-3 ${filter === tab ? 'font-bold' : 'text-x-dim'}`}
            >
              {tab === 'inbox' ? t('dm.tabInbox') : t('dm.tabRequests')}
              {tab === 'requests' && requestCount > 0 && (
                <span className="ml-1.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-x-blue px-1 text-[11px] font-bold text-white">
                  {requestCount > 99 ? '99+' : requestCount}
                </span>
              )}
              {filter === tab && (
                <span className="absolute bottom-0 left-0 h-1 w-full rounded-full bg-x-blue" />
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {query.items.map((c) => (
          <ConversationListItem
            key={c.id}
            conversation={c}
            active={c.id === activeId}
            onClick={() => navigate(`/messages/${c.id}`)}
          />
        ))}
        {query.items.length === 0 && !query.isLoading && (
          <div className="px-6 py-10 text-center">
            <div className="text-lg font-bold">
              {filter === 'inbox' ? t('dm.emptyList') : t('dm.emptyRequests')}
            </div>
            {filter === 'inbox' && <div className="mt-1 text-[14px] text-x-dim">{t('dm.emptyHint')}</div>}
          </div>
        )}
        <LoadMore
          hasNextPage={query.hasNextPage ?? false}
          isFetching={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        />
      </div>
    </div>
  );
}
