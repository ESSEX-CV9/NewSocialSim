import type { MediaView, PostView } from '@socialsim/shared';
import { useRef, useState } from 'react';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';

const MAX_LENGTH = 280;
const MAX_MEDIA = 4;
const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';

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
  const [media, setMedia] = useState<MediaView[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlInputOpen, setUrlInputOpen] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!user) return null;
  const remaining = MAX_LENGTH - content.length;
  const empty = content.trim().length === 0 && media.length === 0;

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const hasVideo = picked.some((f) => f.type.startsWith('video/'));
    // 视频只能单独发布：不与图片混选，也不追加到已有媒体
    if ((hasVideo && (picked.length > 1 || media.length > 0)) || media.some((m) => m.type === 'video')) {
      setError(t('composer.videoLimit'));
      return;
    }
    if (picked.length > MAX_MEDIA - media.length) {
      setError(t('composer.imageLimit'));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const uploaded: MediaView[] = [];
      for (const file of picked) {
        const res = await api.uploadMedia(file);
        uploaded.push(res.media);
      }
      setMedia((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const addFromUrl = async () => {
    const url = urlValue.trim();
    if (!url || uploading) return;
    if (media.length >= MAX_MEDIA || media.some((m) => m.type === 'video')) {
      setError(media.some((m) => m.type === 'video') ? t('composer.videoLimit') : t('composer.imageLimit'));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const res = await api.mediaFromUrl(url);
      setMedia((prev) => [...prev, res.media]);
      setUrlValue('');
      setUrlInputOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (empty || remaining < 0 || busy || uploading) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createPost({
        content: content.trim(),
        ...(replyToId !== undefined ? { replyToId } : {}),
        ...(quoteOfId !== undefined ? { quoteOfId } : {}),
        ...(media.length > 0 ? { mediaIds: media.map((m) => m.id) } : {}),
      });
      setContent('');
      setMedia([]);
      onPosted(res.post);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex gap-3 p-4 ${bordered ? 'border-b border-x-border' : ''}`}>
      <Avatar handle={user.handle} avatarUrl={user.avatarUrl} />
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
        {media.length > 0 && (
          <div className={`mb-2 grid gap-2 ${media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {media.map((m) => (
              <div key={m.id} className="relative overflow-hidden rounded-2xl border border-x-border">
                {m.type === 'video' ? (
                  <video src={m.url} controls preload="metadata" className="max-h-72 w-full" />
                ) : (
                  <img src={m.url} alt="" className="max-h-72 w-full object-cover" draggable={false} />
                )}
                <button
                  aria-label={t('composer.removeImage')}
                  onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))}
                  className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/70 text-white transition-colors duration-200 hover:bg-black/90"
                >
                  <i className="ri-close-line text-[16px]" />
                </button>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="mb-2 text-sm text-x-red">{t('common.error', { message: error })}</div>
        )}
        {urlInputOpen && (
          <div className="mb-2 flex items-center gap-2">
            <input
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder={t('composer.urlPrompt')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addFromUrl();
                if (e.key === 'Escape') setUrlInputOpen(false);
              }}
              className="min-w-0 flex-1 rounded-full border border-x-border bg-transparent px-4 py-1.5 text-[14px] outline-none placeholder:text-x-dim focus:border-x-blue"
            />
            <button
              onClick={() => void addFromUrl()}
              disabled={uploading || urlValue.trim().length === 0}
              className="rounded-full bg-x-blue px-4 py-1.5 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
            >
              {t('composer.urlAdd')}
            </button>
          </div>
        )}
        <div className="mt-1 flex items-center border-t border-x-border pt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => void pickFiles(e.target.files)}
          />
          <button
            aria-label={t('composer.addMedia')}
            title={t('composer.addMedia')}
            disabled={uploading || media.length >= MAX_MEDIA || media.some((m) => m.type === 'video')}
            onClick={() => fileInputRef.current?.click()}
            className="flex size-8.5 items-center justify-center rounded-full text-x-blue transition-colors duration-200 hover:bg-x-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className={`${uploading ? 'ri-loader-4-line animate-spin' : 'ri-image-line'} text-[18px]`} />
          </button>
          <button
            aria-label={t('composer.addFromUrl')}
            title={t('composer.addFromUrl')}
            disabled={uploading || media.length >= MAX_MEDIA || media.some((m) => m.type === 'video')}
            onClick={() => setUrlInputOpen((v) => !v)}
            className="flex size-8.5 items-center justify-center rounded-full text-x-blue transition-colors duration-200 hover:bg-x-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className="ri-link text-[18px]" />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <span
              className={`text-[13px] ${
                remaining < 0 ? 'text-x-red' : remaining < 20 ? 'text-amber-500' : 'text-x-dim'
              }`}
            >
              {remaining}
            </span>
            <button
              onClick={() => void submit()}
              disabled={busy || uploading || empty || remaining < 0}
              className="rounded-full bg-x-blue px-5 py-1.5 text-[15px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {buttonText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
