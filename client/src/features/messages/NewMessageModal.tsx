import type { UserSummary } from '@socialsim/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { useI18n } from '../../i18n/I18nContext';

/** 新建私信弹窗：搜索用户（300ms 防抖）→ 找或建会话 → 跳转 */
export function NewMessageModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const keyword = q.trim();
    if (keyword.length === 0) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .searchUsers(keyword, undefined, 10)
        .then((r) => setResults(r.items.filter((u) => u.id !== user?.id)))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, user?.id]);

  const pick = async (target: UserSummary) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.dmFindOrCreate(target.id);
      onClose();
      navigate(`/messages/${res.conversation.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-x-border bg-x-bg"
      >
        <div className="flex items-center gap-4 p-3">
          <button
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
          >
            <i className="ri-close-line text-[18px]" />
          </button>
          <h2 className="text-lg font-bold">{t('dm.newMessage')}</h2>
        </div>
        <div className="flex items-center gap-2 border-b border-x-border px-4 pb-3">
          <i className="ri-search-line text-[17px] text-x-blue" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('dm.searchUser')}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-x-dim"
          />
        </div>
        {error && <div className="px-4 py-2 text-sm text-x-red">{error}</div>}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
          {results.map((u) => (
            <button
              key={u.id}
              disabled={busy}
              onClick={() => void pick(u)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 hover:bg-x-input disabled:opacity-60"
            >
              <Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={40} />
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-[15px] font-bold">
                  <span className="truncate">{u.displayName}</span>
                  <VerifiedBadge verified={u.verified} size={14} />
                </div>
                <div className="truncate text-[13px] text-x-dim">@{u.handle}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
