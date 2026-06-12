import type { MediaView, PostView, UserSummary } from '@socialsim/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type VideoTaskView } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { Avatar } from './Avatar';
import { IngestTaskTile } from './IngestTaskTile';
import { MediaSearchPanel } from './MediaSearchPanel';
import { MentionCandidateList, useMentionCandidates } from './useMentionCandidates';

const ACTIVE_TASK_STATUSES = ['pending', 'probing', 'downloading'];

const MAX_LENGTH = 280;
/** 与服务端 MAX_PER_POST 一致：图/视频共享配额且可混排 */
const MAX_MEDIA = 20;
const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';
/** 输入框内实时高亮的片段：与发布后 PostContent 的解析口径一致（URL / #话题 / @用户名） */
const HIGHLIGHT_RE = /https?:\/\/[^\s]+|#[^\s#@]+|@[a-zA-Z0-9_]{2,20}/g;

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
  const [urlKind, setUrlKind] = useState<'image' | 'video'>('image');
  const [urlMode, setUrlMode] = useState<'auto' | 'download' | 'stream'>('auto');
  const [notice, setNotice] = useState<string | null>(null);
  /** 本发帖框创建的视频引入任务 id（任务本体由服务端持有，轮询取回） */
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const taskIdsRef = useRef(taskIds);
  taskIdsRef.current = taskIds;
  const handledTaskIds = useRef(new Set<string>());
  const [searchOpen, setSearchOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionCtl = useMentionCandidates();

  const tasksQuery = useQuery({
    queryKey: ['video-tasks'],
    queryFn: api.videoTasks,
    enabled: taskIds.length > 0,
    // 有跟踪中的活跃任务（或刚建还没出现在列表里）时 1.5s 轮询，否则停
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks ?? [];
      const tracked = tasks.filter((tk) => taskIdsRef.current.includes(tk.id));
      const anyActive = tracked.some((tk) => ACTIVE_TASK_STATUSES.includes(tk.status));
      return anyActive || tracked.length < taskIdsRef.current.length ? 1500 : false;
    },
  });
  const trackedTasks: VideoTaskView[] = (tasksQuery.data?.tasks ?? []).filter((tk) =>
    taskIds.includes(tk.id),
  );
  const ingesting = trackedTasks.some((tk) => ACTIVE_TASK_STATUSES.includes(tk.status));

  // 任务完成：媒体进托盘、任务移出跟踪（handled 防 StrictMode/竞态重复追加）
  useEffect(() => {
    const tasks = tasksQuery.data?.tasks ?? [];
    for (const tk of tasks) {
      if (!taskIdsRef.current.includes(tk.id) || handledTaskIds.current.has(tk.id)) continue;
      if (tk.status === 'done' && tk.media) {
        handledTaskIds.current.add(tk.id);
        const m = tk.media;
        setMedia((prev) =>
          prev.length >= MAX_MEDIA || prev.some((x) => x.id === m.id) ? prev : [...prev, m],
        );
        setTaskIds((prev) => prev.filter((x) => x !== tk.id));
      } else if (tk.status === 'canceled') {
        handledTaskIds.current.add(tk.id);
        setTaskIds((prev) => prev.filter((x) => x !== tk.id));
      }
    }
  }, [tasksQuery.data]);

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

  /** 选中候选：把光标前的 @prefix 替换为 @handle + 空格 */
  const pickMention = (u: UserSummary) => {
    const picked = mentionCtl.applyPick(content, u);
    if (!picked) return;
    setContent(picked.next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(picked.caret, picked.caret);
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
    setNotice(null);
    try {
      if (urlKind === 'video') {
        // 视频默认走形态路由（auto）：可嵌入站点返回 embed（URL 留正文走链接卡），否则建异步任务；
        // 用户也可显式指定下载/流式
        const res = await api.videoIngest(url, urlMode);
        if (res.embed) {
          setContent((prev) => (prev.trim().length > 0 ? `${prev.trimEnd()} ${url}` : url));
          setNotice(t('composer.videoEmbedHint'));
        } else if (res.task) {
          setTaskIds((prev) => [...prev, res.task!.id]);
        }
      } else {
        const res = await api.mediaFromUrl(url);
        setMedia((prev) => [...prev, res.media]);
      }
      setUrlValue('');
      setUrlInputOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  /** 失败任务重试：按任务原模式重新发起（绕过 auto，避免 siteModes 期间被改的歧义） */
  const retryTask = async (tk: VideoTaskView) => {
    setError(null);
    try {
      const res = await api.videoIngest(tk.url, tk.mode);
      if (res.task) {
        setTaskIds((prev) => [...prev.filter((x) => x !== tk.id), res.task!.id]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const cancelTask = async (id: string) => {
    try {
      await api.videoTaskCancel(id);
    } catch {
      // 任务可能已终态/被清扫，直接移出跟踪
    }
    setTaskIds((prev) => prev.filter((x) => x !== id));
  };

  const submit = async () => {
    if (empty || remaining < 0 || busy || uploading || ingesting) return;
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
              mentionCtl.updateFromCaret(e.target);
            }}
            onSelect={(e) => mentionCtl.updateFromCaret(e.currentTarget)}
            onBlur={() => {
              // 延迟关闭，给候选条目的 onMouseDown 留出执行窗口
              setTimeout(() => mentionCtl.setMention(null), 150);
            }}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className="absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-xl text-transparent outline-none placeholder:text-x-dim"
            style={{ caretColor: 'var(--th-text)' }}
            onKeyDown={(e) => {
              if (mentionCtl.handleKeyDown(e, pickMention)) return;
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void submit();
            }}
          />
          <MentionCandidateList
            candidates={mentionCtl.mention ? mentionCtl.candidates : []}
            candidateIdx={mentionCtl.candidateIdx}
            onHoverIdx={mentionCtl.setCandidateIdx}
            onPick={pickMention}
            className="top-full left-0"
          />
        </div>
        {/* 预览：单媒体大图；多媒体横向滚动缩略条（20 个上限下网格会撑爆发帖框） */}
        {media.length === 1 && (
          <div className="relative mb-2 overflow-hidden rounded-2xl border border-x-border">
            {media[0]!.type === 'video' ? (
              <video
                src={media[0]!.url}
                controls
                preload="metadata"
                poster={media[0]!.posterUrl ?? undefined}
                className="max-h-72 w-full"
              />
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
                    {m.posterUrl ? (
                      <img src={m.posterUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <video src={m.url} preload="metadata" muted className="h-full w-full object-cover" />
                    )}
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
        {/* 视频引入任务托盘：进行中/失败的占位卡，完成自动转入媒体预览 */}
        {trackedTasks.length > 0 && (
          <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
            {trackedTasks.map((tk) => (
              <IngestTaskTile
                key={tk.id}
                task={tk}
                onCancel={() => void cancelTask(tk.id)}
                onRetry={() => void retryTask(tk)}
                onDismiss={() => setTaskIds((prev) => prev.filter((x) => x !== tk.id))}
              />
            ))}
          </div>
        )}
        {error && (
          <div className="mb-2 text-sm text-x-red">{t('common.error', { message: error })}</div>
        )}
        {notice && <div className="mb-2 text-sm text-x-dim">{notice}</div>}
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
            {/* 引入类型切换：图片走 from-url 同步入库，视频走异步任务（auto 形态路由） */}
            <div className="flex shrink-0 overflow-hidden rounded-full border border-x-border text-[12px]">
              {(['image', 'video'] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setUrlKind(kind)}
                  className={`px-2.5 py-1 font-bold transition-colors duration-200 ${
                    urlKind === kind ? 'bg-x-blue text-white' : 'text-x-dim hover:bg-x-hover'
                  }`}
                >
                  {t(kind === 'image' ? 'composer.urlKindImage' : 'composer.urlKindVideo')}
                </button>
              ))}
            </div>
            {urlKind === 'video' && (
              <select
                value={urlMode}
                onChange={(e) => setUrlMode(e.target.value as typeof urlMode)}
                className="shrink-0 rounded-full border border-x-border bg-x-bg px-2 py-1 text-[12px] text-x-dim outline-none focus:border-x-blue"
              >
                <option value="auto">{t('composer.videoModeAuto')}</option>
                <option value="download">{t('composer.videoModeDownload')}</option>
                <option value="stream">{t('composer.videoModeStream')}</option>
              </select>
            )}
            <input
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder={t(urlKind === 'video' ? 'composer.urlPromptVideo' : 'composer.urlPrompt')}
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
              disabled={busy || uploading || ingesting || empty || remaining < 0}
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
