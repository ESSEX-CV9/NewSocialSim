import type { ConversationDetailView } from '@socialsim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { Avatar } from '../../components/Avatar';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { useI18n } from '../../i18n/I18nContext';

/** 会话信息弹窗（对照 X）：对方概览 + 资料入口 + 屏蔽/解除屏蔽（仅实现已有能力对应的项） */
export function ConversationInfoModal({
  conversation,
  onClose,
}: {
  conversation: ConversationDetailView;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const other = conversation.otherParticipant;

  // 复用资料页缓存判断屏蔽方向（blockedEither 不含方向信息）
  const profile = useQuery({
    queryKey: ['user', other.handle],
    queryFn: () => api.getUser(other.handle),
  });
  const blocked = profile.data?.user.blockedByViewer ?? false;

  const toggleBlock = async () => {
    if (!blocked && !window.confirm(t('post.blockConfirm', { handle: other.handle }))) return;
    if (blocked) await api.unblockUser(other.handle);
    else await api.blockUser(other.handle);
    void queryClient.invalidateQueries({ queryKey: ['user', other.handle] });
    void queryClient.invalidateQueries({ queryKey: ['dm-conversation', conversation.id] });
    void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-x-border bg-x-bg pb-2"
      >
        <div className="p-3">
          <button
            aria-label={t('dm.back')}
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
          >
            <i className="ri-arrow-left-line text-[19px]" />
          </button>
        </div>
        <div className="flex flex-col items-center px-6">
          <Avatar handle={other.handle} avatarUrl={other.avatarUrl} size={88} />
          <div className="mt-3 flex items-center gap-1 text-lg font-bold">
            <span className="truncate">{other.displayName}</span>
            <VerifiedBadge verified={other.verified} size={16} />
          </div>
          <div className="text-[14px] text-x-dim">@{other.handle}</div>
          {/* 操作行：仅保留有对应能力的「资料」 */}
          <div className="mt-5 flex items-start gap-6">
            <button
              onClick={() => {
                onClose();
                navigate(`/u/${other.handle}`);
              }}
              className="group flex flex-col items-center gap-1.5"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-x-input transition-colors duration-200 group-hover:bg-x-hover-strong">
                <i className="ri-user-line text-[20px]" />
              </span>
              <span className="text-[13px] text-x-dim">{t('nav.profile')}</span>
            </button>
          </div>
        </div>
        <div className="mt-6 border-t border-x-border">
          <button
            onClick={() => void toggleBlock()}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-[15px] font-bold text-x-red transition-colors duration-200 hover:bg-x-hover-strong"
          >
            <i className="ri-prohibited-line text-[17px]" />
            {blocked ? `${t('profile.unblock')} @${other.handle}` : t('post.blockAuthor', { handle: other.handle })}
          </button>
        </div>
      </div>
    </div>
  );
}
