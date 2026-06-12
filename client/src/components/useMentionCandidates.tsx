import type { UserSummary } from '@socialsim/shared';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { api } from '../api/endpoints';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

/** 光标前进行中的 @mention（@ 前必须是行首或非 handle 字符，避免 email 误触发） */
const ACTIVE_MENTION_RE = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{0,20})$/;

interface ActiveMention {
  /** @ 字符的下标 */
  start: number;
  /** 已输入的 handle 前缀 */
  prefix: string;
}

/** @ 候选的状态机：发帖 Composer 与私信 MessageComposer 共用 */
export function useMentionCandidates() {
  const [mention, setMention] = useState<ActiveMention | null>(null);
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

  /** 根据光标位置更新进行中的 @mention 状态（onChange/onSelect 共用） */
  const updateFromCaret = (el: HTMLTextAreaElement) => {
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

  /** 选中候选：把光标前的 @prefix 替换为 @handle + 空格；返回新文本与目标光标位 */
  const applyPick = (content: string, u: UserSummary): { next: string; caret: number } | null => {
    if (!mention) return null;
    const end = mention.start + 1 + mention.prefix.length;
    const next = `${content.slice(0, mention.start)}@${u.handle} ${content.slice(end)}`;
    const caret = mention.start + u.handle.length + 2;
    setMention(null);
    setCandidates([]);
    return { next, caret };
  };

  /** 候选打开时的键盘导航；返回 true 表示事件已被消费，调用方应直接 return */
  const handleKeyDown = (
    e: KeyboardEvent<HTMLTextAreaElement>,
    pick: (u: UserSummary) => void,
  ): boolean => {
    if (!mention || candidates.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCandidateIdx((i) => (i + 1) % candidates.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCandidateIdx((i) => (i - 1 + candidates.length) % candidates.length);
      return true;
    }
    if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
      e.preventDefault();
      pick(candidates[candidateIdx]!);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setMention(null);
      return true;
    }
    return false;
  };

  return {
    mention,
    candidates,
    candidateIdx,
    setCandidateIdx,
    setMention,
    updateFromCaret,
    applyPick,
    handleKeyDown,
  };
}

/** 候选下拉列表（定位类由调用方经 className 传入，如 "top-full left-0"） */
export function MentionCandidateList({
  candidates,
  candidateIdx,
  onHoverIdx,
  onPick,
  className,
}: {
  candidates: UserSummary[];
  candidateIdx: number;
  onHoverIdx: (i: number) => void;
  onPick: (u: UserSummary) => void;
  className: string;
}) {
  if (candidates.length === 0) return null;
  return (
    <div
      className={`absolute z-30 w-72 overflow-hidden rounded-xl border border-x-border bg-x-card shadow-lg ${className}`}
    >
      {candidates.map((u, i) => (
        <button
          key={u.id}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(u);
          }}
          onMouseEnter={() => onHoverIdx(i)}
          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 ${
            i === candidateIdx ? 'bg-x-input' : ''
          }`}
        >
          <Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={36} />
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
  );
}
