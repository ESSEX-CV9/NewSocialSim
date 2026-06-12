import type { MessageView } from '@socialsim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { usePagedQuery } from '../../components/usePagedQuery';
import { UserHoverCard } from '../../components/UserHoverCard';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { useI18n } from '../../i18n/I18nContext';
import { ConversationInfoModal } from './ConversationInfoModal';
import { useDmStream } from './DmStreamContext';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';

/** 会话视图：头部对方信息 + 消息区（倒序取升序展示）+ 输入框/请求横幅/屏蔽提示 */
export function ConversationView({ conversationId }: { conversationId: number }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { connected } = useDmStream();
  const [infoOpen, setInfoOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['dm-conversation', conversationId],
    queryFn: () => api.dmGetConversation(conversationId),
  });
  const detail = detailQuery.data?.conversation;

  const messagesQuery = usePagedQuery(
    ['dm-messages', conversationId],
    (cursor) => api.dmMessages(conversationId, cursor),
    // SSE 在线时靠事件写穿缓存；断线回退 10 秒轮询兜底
    { refetchInterval: connected ? false : 10_000 },
  );

  // 倒序存储 → 升序渲染
  const ordered = useMemo(() => [...messagesQuery.items].reverse(), [messagesQuery.items]);
  const latestId = messagesQuery.items[0]?.id;
  const latestFromOther =
    messagesQuery.items[0] !== undefined && messagesQuery.items[0].sender.id !== user?.id;

  // —— 滚动管理 ——
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialScrolled = useRef(false);
  // 加载更早页前记录内容高度，prepend 后恢复差值防跳动
  const prevHeightRef = useRef<number | null>(null);

  const loadOlder = () => {
    prevHeightRef.current = scrollRef.current?.scrollHeight ?? null;
    void messagesQuery.fetchNextPage();
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || ordered.length === 0) return;
    if (!initialScrolled.current) {
      el.scrollTop = el.scrollHeight;
      initialScrolled.current = true;
      return;
    }
    if (prevHeightRef.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
      prevHeightRef.current = null;
    }
  }, [ordered.length]);

  // 新消息到达且视口在底部附近时自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || latestId === undefined || !initialScrolled.current) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [latestId]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // —— 已读上报：对方新消息出现、或带手动未读标记打开时上报（请求态不上报，接受前不暴露已读，与 X 一致）——
  const conversationState = detail?.state;
  const markedUnread = detail?.markedUnread ?? false;
  useEffect(() => {
    if (latestId === undefined) return;
    if (conversationState !== 'inbox') return;
    if (!latestFromOther && !markedUnread) return;
    void api.dmMarkRead(conversationId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['dm-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
      if (markedUnread) {
        void queryClient.invalidateQueries({ queryKey: ['dm-conversation', conversationId] });
      }
    });
  }, [latestId, latestFromOther, conversationState, markedUnread, conversationId, queryClient]);

  // 对方已读到的最后一条本人消息（在其下方显示「已读」）
  const seenMessageId = useMemo(() => {
    if (!detail || detail.otherLastReadMessageId === 0) return null;
    const mine = messagesQuery.items.find(
      (m) => m.sender.id === user?.id && m.id <= detail.otherLastReadMessageId,
    );
    return mine?.id ?? null;
  }, [detail, messagesQuery.items, user?.id]);

  const acceptRequest = async () => {
    await api.dmAccept(conversationId);
    void queryClient.invalidateQueries({ queryKey: ['dm-conversation', conversationId] });
    void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['dm-unread'] });
  };

  const hideConversation = async () => {
    if (!window.confirm(t('dm.deleteConversationConfirm'))) return;
    await api.dmHideConversation(conversationId);
    void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['dm-unread'] });
    navigate('/messages');
  };

  if (detailQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center text-x-dim">
        {t('common.error', { message: (detailQuery.error as Error).message })}
      </div>
    );
  }
  if (!detail) return <div className="flex-1" />;

  const other = detail.otherParticipant;

  // 渲染消息 + 跨天日期分隔条
  const rows: ReactNode[] = [];
  let lastDay = '';
  for (const m of ordered) {
    const day = new Date(m.createdAt).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    if (day !== lastDay) {
      lastDay = day;
      rows.push(
        <div key={`day-${m.id}`} className="my-2 text-center text-[12px] text-x-dim">
          {day}
        </div>,
      );
    }
    rows.push(
      <MessageBubble
        key={m.id}
        message={m}
        isOwn={m.sender.id === user?.id}
        showSeen={m.id === seenMessageId}
      />,
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* 头部：对方信息（悬停出用户卡，点击进主页）+ 会话信息弹窗 */}
      <div className="flex items-center gap-3 border-b border-x-border px-4 py-2">
        <UserHoverCard handle={other.handle}>
          <Link
            to={`/u/${other.handle}`}
            className="flex min-w-0 items-center gap-3 rounded-full py-1 pr-3 text-left transition-colors duration-200 hover:bg-x-hover-strong"
          >
            <Avatar handle={other.handle} avatarUrl={other.avatarUrl} size={36} />
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-[16px] font-bold">
                <span className="truncate">{other.displayName}</span>
                <VerifiedBadge verified={other.verified} size={15} />
              </div>
              <div className="truncate text-[13px] text-x-dim">@{other.handle}</div>
            </div>
          </Link>
        </UserHoverCard>
        <button
          aria-label={t('dm.conversationInfo')}
          title={t('dm.conversationInfo')}
          onClick={() => setInfoOpen(true)}
          className="ml-auto flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
        >
          <i className="ri-more-fill text-[17px]" />
        </button>
      </div>
      {infoOpen && (
        <ConversationInfoModal conversation={detail} onClose={() => setInfoOpen(false)} />
      )}

      {/* 消息区 */}
      <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto py-3">
        {messagesQuery.hasNextPage && (
          <button
            onClick={loadOlder}
            disabled={messagesQuery.isFetchingNextPage}
            className="mx-auto mb-2 block rounded-full px-4 py-1.5 text-[13px] text-x-blue transition-colors duration-200 hover:bg-x-hover disabled:opacity-50"
          >
            {messagesQuery.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
          </button>
        )}
        <div className="flex flex-col gap-3">{rows}</div>
      </div>

      {/* 底部：屏蔽提示 / 请求横幅 / 输入框 */}
      {detail.blockedEither ? (
        <div className="border-t border-x-border p-4 text-center text-[14px] text-x-dim">
          {t('dm.blockedHint')}
        </div>
      ) : detail.state === 'request' ? (
        <div className="border-t border-x-border p-4">
          <div className="text-[15px] font-bold">
            @{other.handle} {t('dm.requestBanner')}
          </div>
          <div className="mt-1 text-[13px] text-x-dim">{t('dm.requestHint')}</div>
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => void hideConversation()}
              className="flex-1 rounded-full border border-x-border py-2 text-[15px] font-bold transition-colors duration-200 hover:bg-x-input"
            >
              {t('dm.decline')}
            </button>
            <button
              onClick={() => void acceptRequest()}
              className="flex-1 rounded-full bg-x-blue py-2 text-[15px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark"
            >
              {t('dm.accept')}
            </button>
          </div>
        </div>
      ) : (
        <MessageComposer conversationId={conversationId} onSent={scrollToBottom} />
      )}
    </div>
  );
}
