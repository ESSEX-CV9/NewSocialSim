import type { MediaView } from '@socialsim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../../api/endpoints';
import { useI18n } from '../../i18n/I18nContext';
import { prependDmMessage } from './dmCache';

/** 与服务端 MAX_PER_MESSAGE 一致 */
const MAX_MEDIA = 4;
const MAX_LENGTH = 1000;
const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';

/** 私信输入框：自适应高度 + 媒体（≤4）+ Enter 发送 / Shift+Enter 换行 */
export function MessageComposer({
  conversationId,
  onSent,
}: {
  conversationId: number;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [media, setMedia] = useState<MediaView[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const empty = content.trim().length === 0 && media.length === 0;

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    if (picked.length > MAX_MEDIA - media.length) {
      setError(t('dm.mediaLimit', { n: MAX_MEDIA }));
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

  const send = async () => {
    if (empty || busy || uploading || content.length > MAX_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.dmSend(conversationId, content.trim(), media.map((m) => m.id));
      // 发送者本人不经 SSE 回推：直接写穿消息缓存即时上屏
      prependDmMessage(queryClient, conversationId, res.message);
      void queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
      setContent('');
      setMedia([]);
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.focus();
      }
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-x-border p-3">
      {media.length > 0 && (
        <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
          {media.map((m) => (
            <div
              key={m.id}
              className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-x-border bg-x-input"
            >
              {m.type === 'video' ? (
                <>
                  <video src={m.url} preload="metadata" muted className="h-full w-full object-cover" />
                  <i className="ri-play-circle-fill pointer-events-none absolute right-1 bottom-1 text-[16px] text-white drop-shadow" />
                </>
              ) : (
                <img src={m.url} alt="" className="h-full w-full object-cover" draggable={false} />
              )}
              <button
                aria-label={t('composer.removeImage')}
                onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))}
                className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white transition-colors duration-200 hover:bg-black/90"
              >
                <i className="ri-close-line text-[12px]" />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="mb-2 text-sm text-x-red">{error}</div>}
      <div className="flex items-end gap-1 rounded-2xl bg-x-input px-2 py-1.5">
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
          disabled={uploading || media.length >= MAX_MEDIA}
          onClick={() => fileInputRef.current?.click()}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-x-blue transition-colors duration-200 hover:bg-x-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <i className={`${uploading ? 'ri-loader-4-line animate-spin' : 'ri-image-line'} text-[18px]`} />
        </button>
        <textarea
          ref={textareaRef}
          value={content}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder={t('dm.placeholder')}
          onChange={(e) => {
            setContent(e.target.value);
            autoResize(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="max-h-40 min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-[15px] outline-none placeholder:text-x-dim"
        />
        <button
          aria-label={t('dm.send')}
          title={t('dm.send')}
          disabled={busy || uploading || empty}
          onClick={() => void send()}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-x-blue transition-colors duration-200 hover:bg-x-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <i className="ri-send-plane-2-fill text-[18px]" />
        </button>
      </div>
    </div>
  );
}
