import { useEffect, useRef } from 'react';
import { api } from '../api/endpoints';

const reported = new Set<number>(); // 页面会话内已上报（刷新即清空）
const queue = new Set<number>(); // 待上报队列
const idOf = new WeakMap<Element, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let observer: IntersectionObserver | null = null;

const FLUSH_DELAY_MS = 2000;
const FLUSH_MAX = 20; // 满 20 条立即发（接口上限 100，留足余量）

function flush(useBeacon = false): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.size === 0) return;
  const ids = [...queue];
  queue.clear();
  if (useBeacon && navigator.sendBeacon) {
    // 页面隐藏/关闭时兜底；beacon 不带 Authorization，接口为 optionalAuth 所以可行
    navigator.sendBeacon(
      '/api/posts/views',
      new Blob([JSON.stringify({ ids })], { type: 'application/json' }),
    );
  } else {
    void api.recordViews(ids).catch(() => {}); // 尽力而为，失败不重试
  }
}

function scheduleFlush(): void {
  if (queue.size >= FLUSH_MAX) return flush();
  if (timer === null) timer = setTimeout(() => flush(), FLUSH_DELAY_MS);
}

function getObserver(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer!.unobserve(e.target);
        const id = idOf.get(e.target);
        if (id === undefined || reported.has(id)) continue;
        reported.add(id);
        queue.add(id);
        scheduleFlush();
      }
    },
    { threshold: 0.5 }, // 卡片露出约一半才算曝光（对齐 X）
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  return observer;
}

/** 世界热切换不刷新页面而帖子 id 空间不同，必须清空会话状态 */
export function resetViewTracking(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  reported.clear();
  queue.clear();
}

/** 挂到帖子卡片根元素：进入视口算一次曝光，会话内去重，批量上报 */
export function useViewTracking(postId: number, enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || reported.has(postId)) return;
    idOf.set(el, postId);
    const obs = getObserver();
    obs.observe(el);
    return () => obs.unobserve(el);
  }, [postId, enabled]);
  return ref;
}
