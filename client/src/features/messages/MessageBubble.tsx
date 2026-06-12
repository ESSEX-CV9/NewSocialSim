import type { MessageView } from '@socialsim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { LinkCard } from '../../components/LinkCard';
import { MediaGrid } from '../../components/MediaGrid';
import { PostContent } from '../../components/PostContent';
import { UserHoverCard } from '../../components/UserHoverCard';
import { useI18n } from '../../i18n/I18nContext';
import { ReactionPicker } from './ReactionPicker';

/** 单条消息：气泡 + 媒体 + 回应行 + 时间/已读；悬浮出回应与删除操作 */
export function MessageBubble({
  message,
  isOwn,
  showSeen,
}: {
  message: MessageView;
  isOwn: boolean;
  /** 是否在此消息下方显示「已读」（仅对方已读到的最后一条本人消息） */
  showSeen: boolean;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const myReaction = message.reactions.find((r) => r.userId === user?.id);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['dm-messages', message.conversationId] });

  const toggleReaction = async (emoji: string) => {
    setPickerOpen(false);
    try {
      if (myReaction?.emoji === emoji) await api.dmRemoveReaction(message.id);
      else await api.dmSetReaction(message.id, emoji);
      await invalidate();
    } catch {
      // 失败静默（消息可能刚被删除），下次轮询/事件会纠正
    }
  };

  const deleteMessage = async () => {
    if (!window.confirm(t('dm.deleteMessageConfirm'))) return;
    try {
      await api.dmDeleteMessage(message.id);
      await invalidate();
    } catch {
      await invalidate();
    }
  };

  const time = new Date(message.createdAt).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (message.deleted) {
    return (
      <div className={`flex flex-col px-4 ${isOwn ? 'items-end' : 'items-start'}`}>
        <div className="rounded-2xl border border-x-border px-4 py-2 text-[14px] text-x-dim italic">
          {t('dm.deletedMessage')}
        </div>
        <div className="mt-1 text-[12px] text-x-dim">{time}</div>
      </div>
    );
  }

  return (
    <div className={`group flex flex-col px-4 ${isOwn ? 'items-end' : 'items-start'}`}>
      <div className={`flex max-w-[78%] items-end gap-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
        <div className="min-w-0">
          {message.media.length > 0 && (
            <div className="w-72 max-w-full">
              <MediaGrid media={message.media} compact />
            </div>
          )}
          {message.content.length > 0 && (
            <div
              className={`mt-1 px-4 py-2 ${
                isOwn
                  ? 'rounded-2xl rounded-br-sm bg-x-blue text-white'
                  : 'rounded-2xl rounded-bl-sm bg-x-input'
              }`}
            >
              <PostContent
                content={message.content}
                linkClass={isOwn ? 'text-white underline hover:opacity-80' : undefined}
                renderMention={(handle, link) => (
                  <UserHoverCard handle={handle}>{link}</UserHoverCard>
                )}
              />
            </div>
          )}
          {message.linkCard && (
            <div className="w-72 max-w-full">
              <LinkCard card={message.linkCard} />
            </div>
          )}
        </div>
        {/* 悬浮操作：回应 +（本人）删除 */}
        <div className="relative mb-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            aria-label={t('dm.react')}
            title={t('dm.react')}
            onClick={() => setPickerOpen((v) => !v)}
            className="flex size-7 items-center justify-center rounded-full text-x-dim transition-colors duration-200 hover:bg-x-input hover:text-x-blue"
          >
            <i className="ri-emotion-line text-[16px]" />
          </button>
          {isOwn && (
            <button
              aria-label={t('dm.deleteMessage')}
              title={t('dm.deleteMessage')}
              onClick={() => void deleteMessage()}
              className="flex size-7 items-center justify-center rounded-full text-x-dim transition-colors duration-200 hover:bg-x-input hover:text-x-red"
            >
              <i className="ri-delete-bin-line text-[16px]" />
            </button>
          )}
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setPickerOpen(false)} />
              <ReactionPicker
                current={myReaction?.emoji}
                align={isOwn ? 'right' : 'left'}
                onPick={(emoji) => void toggleReaction(emoji)}
              />
            </>
          )}
        </div>
      </div>
      {message.reactions.length > 0 && (
        <div className={`mt-1 flex gap-1 ${isOwn ? 'justify-end' : ''}`}>
          {message.reactions.map((r) => (
            <button
              key={`${r.userId}-${r.emoji}`}
              onClick={() => {
                if (r.userId === user?.id) void toggleReaction(r.emoji);
              }}
              className={`rounded-full border bg-x-card px-1.5 py-0.5 text-[13px] ${
                r.userId === user?.id
                  ? 'cursor-pointer border-x-blue'
                  : 'cursor-default border-x-border'
              }`}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 text-[12px] text-x-dim">
        {time}
        {showSeen && <span> · {t('dm.seen')}</span>}
      </div>
    </div>
  );
}
