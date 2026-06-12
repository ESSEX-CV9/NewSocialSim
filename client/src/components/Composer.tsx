import type { MediaView, PostView, UserSummary } from '@socialsim/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';
import { MediaSearchPanel } from './MediaSearchPanel';

const MAX_LENGTH = 280;
/** 与服务端 MAX_PER_POST 一致：图/视频共享配额且可混排 */
const MAX_MEDIA = 20;
const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';
/** 输入框内实时高亮的片段：与发布后 PostContent 的解析口径一致（URL / #话题 / @用户名） */
const HIGHLIGHT_RE = /https?:\/\/[^\s]+|#[^\s#@]+|@[a-zA-Z0-9_]{2,20}/g;
/** 光标前进行中的 @mention（@ 前必须是行首或非 handle 字符，避免 email 误触发） */
const ACTIVE_MENTION_RE = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{0,20})$/;

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
  const [searchOpen, setSearchOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // @ 候选：mention.start 为 @ 字符的下标，prefix 为已输入的 handle 前缀
  const [mention, setMention] = useState<{ start: number; prefix: string } | null>(null);
  const [candidates, setCandidates] = useState<UserSummary[]>([]);
  const [candidateIdx, setCandidateIdx] = useState(0);

  // 候选拉取：有前缀走用户搜索（300ms 防抖），裸 @ 立即给推荐关注作默认候选
  useEffect(() => {
    if (!mention) {
      setCandidates([]);
      return;
    }
    const timer = setTimeout(
      () => {
        const load = mention.prefix
          ? api.searchUsers(mention.prefix, undefined, 5).then((r) => r.items)
          : api.suggestedUsers().then((r) => r.users);
        load
          .then((items) => {
            setCandidates(items.slice(0, 5));
            setCandidateIdx(0);
          })
          .catch(() => setCandidates([]));
      },
      mention.prefix ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [mention]);

  // 高亮镜像层内容：命中片段变蓝，其余原样（含尾随零宽字符保持与 textarea 等高）
  const highlightNodes = useMemo(() => {
    const nodes: ReactNode[] = [];
    let last = 0;
    for (const m of content.matchAll(HIGHLIGHT_RE)) {
      if (m.index > last) nodes.push(content.slice(last, m.index));
      nodes.push(
        <span key={m.index} className="text-x-blue">
          {m[0]}
        </span>,
      );
      last = m.index + m[0].length;
    }
    if (last < content.length) nodes.push(content.slice(last));
    return nodes;
  }, [content]);

  if (!user) return null;
  const remaining = MAX_LENGTH - content.length;
  const empty = content.trim().length === 0 && media.length === 0;

  /** 根据光标位置更新进行中的 @mention 状态（onChange/onSelect 共用） */
  const updateMention = (el: HTMLTextAreaElement) => {
    if (el.selectionStart !== el.selectionEnd) {
      setMention(null);
      return;
    }
    const before = el.value.slice(0, el.selectionStart);
    const m = ACTIVE_MENTION_RE.exec(before);
    if (!m) {
      setMention(null);
      return;
    }
    const prefix = m[2]!;
    setMention((prev) => {
      const start = before.length - prefix.length - 1;
      return prev && prev.start === start && prev.prefix === prefix ? prev : { start, prefix };
    });
  };

  /** 选中候选：把光标前的 @prefix 替换为 @handle + 空格 */
  const pickMention = (u: UserSummary) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.prefix.length;
    setContent(`${content.slice(0, mention.start)}@${u.handle} ${content.slice(end)}`);
    const pos = mention.start + u.handle.length + 2;
    setMention(null);
    setCandidates([]);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    if (picked.length > MAX_MEDIA - media.length) {
      setError(t('composer.mediaLimit', { n: MAX_MEDIA }));
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
    if (media.length >= MAX_MEDIA) {
      setError(t('composer.mediaLimit', { n: MAX_MEDIA }));
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
        {/* 高亮镜像层在文档流中撑高度（textarea 绝对覆盖、禁内部滚动），排版永不错位 */}
        <div className="relative">
          <div aria-hidden className="min-h-15 text-xl wrap-break-word whitespace-pre-wrap">
            {highlightNodes}
            {'​'}
          </div>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              updateMention(e.target);
            }}
            onSelect={(e) => updateMention(e.currentTarget)}
            onBlur={() => {
              // 延迟关闭，给候选条目的 onMouseDown 留出执行窗口
              setTimeout(() => setMention(null), 150);
            }}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className="absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-xl text-transparent outline-none placeholder:text-x-dim"
            style={{ caretColor: 'var(--th-text)' }}
            onKeyDown={(e) => {
              if (mention && candidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCandidateIdx((i) => (i + 1) % candidates.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCandidateIdx((i) => (i - 1 + candidates.length) % candidates.length);
                  return;
                }
                if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
                  e.preventDefault();
                  pickMention(candidates[candidateIdx]!);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void submit();
            }}
          />
          {mention && candidates.length > 0 && (
            <div className="absolute top-full left-0 z-30 w-72 overflow-hidden rounded-xl border border-x-border bg-x-card shadow-lg">
              {candidates.map((u, i) => (
                <button
                  key={u.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(u);
                  }}
                  onMouseEnter={() => setCandidateIdx(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 ${
                    i === candidateIdx ? 'bg-x-input' : ''
                  }`}
                >
                  <Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold">{u.displayName}</div>
                    <div className="truncate text-[13px] text-x-dim">@{u.handle}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 预览：单媒体大图；多媒体横向滚动缩略条（20 个上限下网格会撑爆发帖框） */}
        {media.length === 1 && (
          <div className="relative mb-2 overflow-hidden rounded-2xl border border-x-border">
            {media[0]!.type === 'video' ? (
              <video src={media[0]!.url} controls preload="metadata" className="max-h-72 w-full" />
            ) : (
              <img src={media[0]!.url} alt="" className="max-h-72 w-full object-cover" draggable={false} />
            )}
            <button
              aria-label={t('composer.removeImage')}
              onClick={() => setMedia([])}
              className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/70 text-white transition-colors duration-200 hover:bg-black/90"
            >
              <i className="ri-close-line text-[16px]" />
            </button>
          </div>
        )}
        {media.length > 1 && (
          <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
            {media.map((m) => (
              <div
                key={m.id}
                className="relative size-24 shrink-0 overflow-hidden rounded-xl border border-x-border bg-x-input"
              >
                {m.type === 'video' ? (
                  <>
                    <video src={m.url} preload="metadata" muted className="h-full w-full object-cover" />
                    <i className="ri-play-circle-fill pointer-events-none absolute right-1 bottom-1 text-[18px] text-white drop-shadow" />
                  </>
                ) : (
                  <img src={m.url} alt="" className="h-full w-full object-cover" draggable={false} />
                )}
                <button
                  aria-label={t('composer.removeImage')}
                  onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))}
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/70 text-white transition-colors duration-200 hover:bg-black/90"
                >
                  <i className="ri-close-line text-[14px]" />
                </button>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="mb-2 text-sm text-x-red">{t('common.error', { message: error })}</div>
        )}
        {searchOpen && (
          <MediaSearchPanel
            disabled={media.length >= MAX_MEDIA}
            onPicked={(m) => {
              if (media.length >= MAX_MEDIA) return;
              setMedia((prev) => [...prev, m]);
            }}
          />
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
            disabled={uploading || media.length >= MAX_MEDIA}
            onClick={() => fileInputRef.current?.click()}
            className="flex size-8.5 items-center justify-center rounded-full text-x-blue transition-colors duration-200 hover:bg-x-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className={`${uploading ? 'ri-loader-4-line animate-spin' : 'ri-image-line'} text-[18px]`} />
          </button>
          <button
            aria-label={t('composer.addFromUrl')}
            title={t('composer.addFromUrl')}
            disabled={uploading || media.length >= MAX_MEDIA}
            onClick={() => setUrlInputOpen((v) => !v)}
            className="flex size-8.5 items-center justify-center rounded-full text-x-blue transition-colors duration-200 hover:bg-x-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className="ri-link text-[18px]" />
          </button>
          <button
            aria-label={t('mediaSearch.title')}
            title={t('mediaSearch.title')}
            disabled={uploading || media.length >= MAX_MEDIA}
            onClick={() => setSearchOpen((v) => !v)}
            className="flex size-8.5 items-center justify-center rounded-full text-x-blue transition-colors duration-200 hover:bg-x-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className="ri-search-eye-line text-[18px]" />
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
