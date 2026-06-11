import type { PostView } from '@socialsim/shared';
import { useState } from 'react';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';

const MAX_LENGTH = 280;

interface ComposerProps {
  replyToId?: number;
  quoteOfId?: number;
  placeholder: string;
  buttonText: string;
  autoFocus?: boolean;
  /** 弹窗等无下边框场景传 false */
  bordered?: boolean;
  onPosted: (post: PostView) => void;
}

export function Composer({
  replyToId,
  quoteOfId,
  placeholder,
  buttonText,
  autoFocus,
  bordered = true,
  onPosted,
}: ComposerProps) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const remaining = MAX_LENGTH - content.length;

  const submit = async () => {
    if (content.trim().length === 0 || remaining < 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createPost({
        content: content.trim(),
        ...(replyToId !== undefined ? { replyToId } : {}),
        ...(quoteOfId !== undefined ? { quoteOfId } : {}),
      });
      setContent('');
      onPosted(res.post);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex gap-3 p-4 ${bordered ? 'border-b border-x-border' : ''}`}>
      <Avatar handle={user.handle} />
      <div className="min-w-0 flex-1">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={Math.min(6, Math.max(2, content.split('\n').length))}
          className="w-full resize-none bg-transparent text-xl outline-none placeholder:text-x-dim"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void submit();
          }}
        />
        {error && (
          <div className="mb-2 text-sm text-x-red">{t('common.error', { message: error })}</div>
        )}
        <div className="mt-1 flex items-center justify-end gap-3 border-t border-x-border pt-3">
          <span
            className={`text-[13px] ${
              remaining < 0 ? 'text-x-red' : remaining < 20 ? 'text-amber-500' : 'text-x-dim'
            }`}
          >
            {remaining}
          </span>
          <button
            onClick={() => void submit()}
            disabled={busy || content.trim().length === 0 || remaining < 0}
            className="rounded-full bg-x-blue px-5 py-1.5 text-[15px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}
