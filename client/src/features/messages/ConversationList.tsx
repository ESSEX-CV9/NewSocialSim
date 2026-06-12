import type { ConversationView, DmMessageMatch } from '@socialsim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // 右键上下文菜单（鼠标坐标定位，向上/向左钳制防溢出视口）
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
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

  const deleteConversation = async () => {
    setMenu(null);
    if (!window.confirm(t('dm.deleteConversationConfirm'))) return;
    await api.dmHideConversation(conversation.id);
    void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['dm-unread'] });
    if (active) navigate('/messages');
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({
          x: Math.min(e.clientX, window.innerWidth - 240),
          y: Math.min(e.clientY, window.innerHeight - 110),
        });
      }}
      className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-x-hover-strong ${
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
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 w-56 overflow-hidden rounded-2xl border border-x-border bg-x-card py-1.5 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setMenu(null);
                window.open(`/messages/${conversation.id}`, '_blank');
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-[15px] font-bold transition-colors duration-200 hover:bg-x-hover-strong"
            >
              <i className="ri-external-link-line text-[17px]" />
              {t('dm.openInNewTab')}
            </button>
            <button
              onClick={() => void deleteConversation()}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-[15px] font-bold text-x-red transition-colors duration-200 hover:bg-x-hover-strong"
            >
              <i className="ri-delete-bin-line text-[17px]" />
              {t('dm.deleteConversation')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** 圆形图标空态（对照 X：圆底图标 + 标题 + 提示） */
function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: string;
  title: string;
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-x-input">
        <i className={`${icon} text-[24px] text-x-dim`} />
      </div>
      <div className="mt-4 text-lg font-bold">{title}</div>
      {hint && <div className="mt-1 text-[14px] text-x-dim">{hint}</div>}
    </div>
  );
}

/** 搜索结果：用户段（命中会话）+ 消息段（命中内容） */
function SearchResults({
  query,
  activeId,
  onPick,
}: {
  query: string;
  activeId: number | null;
  onPick: (conversationId: number) => void;
}) {
  const { t } = useI18n();
  const result = useQuery({
    queryKey: ['dm-search', query],
    queryFn: () => api.dmSearch(query),
  });

  if (!result.data) return null;
  const { conversations, messages } = result.data;
  if (conversations.length === 0 && messages.length === 0) {
    return <EmptyState icon="ri-search-line" title={t('dm.searchNoResults')} />;
  }

  const messageRow = (m: DmMessageMatch) => (
    <button
      key={m.messageId}
      onClick={() => onPick(m.conversationId)}
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-x-hover-strong"
    >
      <Avatar handle={m.otherParticipant.handle} avatarUrl={m.otherParticipant.avatarUrl} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[15px]">
          <span className="truncate font-bold">{m.otherParticipant.displayName}</span>
          <VerifiedBadge verified={m.otherParticipant.verified} size={14} />
          <span className="text-x-dim">·</span>
          <span className="shrink-0 text-[13px]">
            <TimeAgo at={m.createdAt} />
          </span>
        </div>
        <div className="truncate text-[14px] text-x-dim">{m.excerpt}</div>
      </div>
    </button>
  );

  return (
    <>
      {conversations.length > 0 && (
        <>
          <div className="px-4 pt-3 pb-1 text-[15px] font-bold">{t('dm.searchPeople')}</div>
          {conversations.map((c) => (
            <ConversationListItem
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              onClick={() => onPick(c.id)}
            />
          ))}
        </>
      )}
      {messages.length > 0 && (
        <>
          <div className="px-4 pt-3 pb-1 text-[15px] font-bold">{t('dm.searchMessages')}</div>
          {messages.map(messageRow)}
        </>
      )}
    </>
  );
}

/** 消息请求视图：返回 + 优先/隐藏 Tab（隐藏 = 拒绝过的请求，可从中恢复） */
function RequestsPane({
  activeId,
  onBack,
}: {
  activeId: number | null;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'requests' | 'hidden'>('requests');

  const query = usePagedQuery(
    ['dm-conversations', tab],
    (cursor) => api.dmConversations(tab, cursor),
    { refetchOnMount: 'always', refetchInterval: 30_000 },
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-5 px-4 py-3">
        <button
          aria-label={t('dm.back')}
          onClick={onBack}
          className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
        >
          <i className="ri-arrow-left-line text-[19px]" />
        </button>
        <h1 className="text-xl font-bold">{t('dm.requests')}</h1>
      </div>
      <div className="flex border-b border-x-border">
        {(['requests', 'hidden'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className="flex-1 py-3 text-center text-[15px] transition-colors duration-200 hover:bg-x-hover-strong"
          >
            <span className={`relative inline-block pb-3 ${tab === k ? 'font-bold' : 'text-x-dim'}`}>
              {k === 'requests' ? t('dm.requestsPriority') : t('dm.requestsHidden')}
              {tab === k && (
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
          <EmptyState
            icon="ri-chat-forward-line"
            title={tab === 'requests' ? t('dm.noRequests') : t('dm.noHiddenRequests')}
            hint={tab === 'requests' ? t('dm.noRequestsHint') : t('dm.noHiddenRequestsHint')}
          />
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

/** 会话列表栏（对照 X Chat）：标题 + 分类器/请求/新建 + 搜索栏 + 列表 */
export function ConversationList({
  activeId,
  onNewMessage,
}: {
  activeId: number | null;
  onNewMessage: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'list' | 'requests'>('list');
  const [filter, setFilter] = useState<'inbox' | 'unread'>('inbox');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQ, setSearchQ] = useState('');

  // 搜索 300ms 防抖
  useEffect(() => {
    const timer = setTimeout(() => setSearchQ(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const unread = useQuery({ queryKey: ['dm-unread'], queryFn: api.dmUnreadCount });
  const requestCount = unread.data?.requestCount ?? 0;

  const query = usePagedQuery(
    ['dm-conversations', filter],
    (cursor) => api.dmConversations(filter, cursor),
    { refetchOnMount: 'always', refetchInterval: 30_000 },
  );

  const markAllRead = async () => {
    setFilterMenuOpen(false);
    await api.dmMarkAllRead();
    void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['dm-unread'] });
  };

  if (mode === 'requests') {
    return <RequestsPane activeId={activeId} onBack={() => setMode('list')} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-xl font-bold">{t('dm.title')}</h1>
        <div className="flex items-center gap-1.5">
          {/* 分类器：全部/未读 + 全部标为已读 */}
          <div className="relative">
            <button
              onClick={() => setFilterMenuOpen((v) => !v)}
              className="flex items-center gap-0.5 rounded-full border border-x-border px-3 py-1.5 text-[13px] font-bold transition-colors duration-200 hover:bg-x-input"
            >
              {filter === 'inbox' ? t('dm.filterAll') : t('dm.filterUnread')}
              <i className="ri-arrow-down-s-line text-[15px]" />
            </button>
            {filterMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setFilterMenuOpen(false)} />
                <div className="absolute top-full right-0 z-30 mt-1 w-56 overflow-hidden rounded-2xl border border-x-border bg-x-card py-1.5 shadow-lg">
                  {(
                    [
                      { key: 'inbox', icon: 'ri-chat-1-line', label: t('dm.filterAll') },
                      { key: 'unread', icon: 'ri-chat-unread-line', label: t('dm.filterUnread') },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.key}
                      onClick={() => {
                        setFilter(item.key);
                        setFilterMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-[15px] font-bold transition-colors duration-200 hover:bg-x-hover-strong"
                    >
                      <i className={`${item.icon} text-[17px]`} />
                      <span className="flex-1 text-left">{item.label}</span>
                      {filter === item.key && <i className="ri-check-line text-[17px] text-x-blue" />}
                    </button>
                  ))}
                  <div className="my-1 border-t border-x-border" />
                  <button
                    onClick={() => void markAllRead()}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-[15px] font-bold transition-colors duration-200 hover:bg-x-hover-strong"
                  >
                    <i className="ri-check-double-line text-[17px]" />
                    {t('dm.markAllRead')}
                  </button>
                </div>
              </>
            )}
          </div>
          {/* 消息请求入口 */}
          <button
            aria-label={t('dm.requests')}
            title={t('dm.requests')}
            onClick={() => setMode('requests')}
            className="relative flex size-9 items-center justify-center rounded-full border border-x-border transition-colors duration-200 hover:bg-x-input"
          >
            <i className="ri-mail-unread-line text-[17px]" />
            {requestCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-x-blue px-1 text-[10px] font-bold text-white">
                {requestCount > 99 ? '99+' : requestCount}
              </span>
            )}
          </button>
          {/* 新建会话 */}
          <button
            aria-label={t('dm.newMessage')}
            title={t('dm.newMessage')}
            onClick={onNewMessage}
            className="flex size-9 items-center justify-center rounded-full border border-x-border transition-colors duration-200 hover:bg-x-input"
          >
            <i className="ri-chat-new-line text-[17px]" />
          </button>
        </div>
      </div>
      {/* 搜索栏：定位会话或具体消息 */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-full bg-x-input px-4 py-2 focus-within:ring-1 focus-within:ring-x-blue">
          <i className="ri-search-line text-[16px] text-x-dim" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('dm.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-x-dim"
          />
          {searchInput.length > 0 && (
            <button
              onClick={() => setSearchInput('')}
              className="flex size-5 items-center justify-center rounded-full bg-x-blue text-white"
            >
              <i className="ri-close-line text-[13px]" />
            </button>
          )}
        </div>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-x-border">
        {searchQ.length > 0 ? (
          <SearchResults
            query={searchQ}
            activeId={activeId}
            onPick={(id) => navigate(`/messages/${id}`)}
          />
        ) : (
          <>
            {query.items.map((c) => (
              <ConversationListItem
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                onClick={() => navigate(`/messages/${c.id}`)}
              />
            ))}
            {query.items.length === 0 && !query.isLoading && (
              <EmptyState
                icon="ri-mail-line"
                title={filter === 'inbox' ? t('dm.emptyList') : t('dm.emptyUnread')}
                hint={filter === 'inbox' ? t('dm.emptyHint') : undefined}
              />
            )}
            <LoadMore
              hasNextPage={query.hasNextPage ?? false}
              isFetching={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            />
          </>
        )}
      </div>
    </div>
  );
}
