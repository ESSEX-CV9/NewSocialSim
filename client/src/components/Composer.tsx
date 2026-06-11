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
  onPosted: (post: PostView) => void;
}

export function Composer({
  replyToId,
  quoteOfId,
  placeholder,
  buttonText,
  autoFocus,
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
    <div className="flex gap-3 border-b border-gray-800 p-4">
      <Avatar handle={user.handle} />
      <div className="min-w-0 flex-1">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={Math.min(6, Math.max(2, content.split('\n').length))}
          className="w-full resize-none bg-transparent text-lg outline-none placeholder:text-gray-600"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void submit();
          }}
        />
        {error && <div className="mb-2 text-sm text-red-400">{t('common.error', { message: error })}</div>}
        <div className="flex items-center justify-end gap-3">
          <span className={`text-sm ${remaining < 20 ? 'text-amber-500' : 'text-gray-600'} ${remaining < 0 ? 'text-red-500' : ''}`}>
            {remaining}
          </span>
          <button
            onClick={() => void submit()}
            disabled={busy || content.trim().length === 0 || remaining < 0}
            className="rounded-full bg-sky-500 px-5 py-1.5 font-bold text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}
