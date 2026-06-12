import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nContext';
import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';
import { NewMessageModal } from './NewMessageModal';

/** 私信页：双栏（左会话列表 + 右会话视图），占满中栏+右栏宽度（Layout 宽模式） */
export function MessagesPage() {
  const { t } = useI18n();
  const { conversationId } = useParams();
  const convId = conversationId !== undefined ? Number(conversationId) : null;
  const [newModalOpen, setNewModalOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <section className="flex w-97 shrink-0 flex-col border-r border-x-border">
        <ConversationList activeId={convId} onNewMessage={() => setNewModalOpen(true)} />
      </section>
      <section className="flex min-w-0 flex-1 flex-col">
        {convId !== null && Number.isFinite(convId) ? (
          <ConversationView key={convId} conversationId={convId} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-8">
            <div className="text-3xl font-extrabold">{t('dm.selectConversation')}</div>
            <div className="mt-2 text-[15px] text-x-dim">{t('dm.selectHint')}</div>
            <button
              onClick={() => setNewModalOpen(true)}
              className="mt-6 rounded-full bg-x-blue px-6 py-3 text-[16px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark"
            >
              {t('dm.newMessage')}
            </button>
          </div>
        )}
      </section>
      {newModalOpen && <NewMessageModal onClose={() => setNewModalOpen(false)} />}
    </div>
  );
}
