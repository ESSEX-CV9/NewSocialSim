/**
 * 视频播放的会话级共享状态：
 * 1. 进度记忆——按媒体 URL 记住播放位置（URL 含 ?w=<worldId>，跨世界天然不串号），
 *    同一视频在帖子卡/详情页/查看器之间切换时从上次位置继续。
 * 2. 单活跃播放——任一视频开始播放时暂停上一个，保证同屏只有一个在播（与 X 一致）。
 */

const progressByUrl = new Map<string, number>();

export function saveVideoProgress(url: string, time: number): void {
  if (time > 0) progressByUrl.set(url, time);
}

export function getVideoProgress(url: string): number {
  return progressByUrl.get(url) ?? 0;
}

export function clearVideoProgress(url: string): void {
  progressByUrl.delete(url);
}

let activeVideo: HTMLVideoElement | null = null;

/** 在 video 的 play 事件里调用：接管"当前唯一在播"身份，暂停上一个 */
export function claimPlayback(el: HTMLVideoElement): void {
  if (activeVideo && activeVideo !== el && !activeVideo.paused) activeVideo.pause();
  activeVideo = el;
}

/**
 * 给 video 元素装上进度记忆 + 单活跃播放的事件钩子。
 * 返回清理函数（保存当前进度并移除监听），在 effect cleanup 中调用。
 */
export function attachVideoPlayback(el: HTMLVideoElement, url: string): () => void {
  const saved = getVideoProgress(url);
  if (saved > 0) el.currentTime = saved;

  const onPlay = () => claimPlayback(el);
  const onPause = () => {
    if (!el.ended) saveVideoProgress(url, el.currentTime);
  };
  const onEnded = () => clearVideoProgress(url);
  el.addEventListener('play', onPlay);
  el.addEventListener('pause', onPause);
  el.addEventListener('ended', onEnded);

  return () => {
    if (!el.ended) saveVideoProgress(url, el.currentTime);
    el.removeEventListener('play', onPlay);
    el.removeEventListener('pause', onPause);
    el.removeEventListener('ended', onEnded);
    if (activeVideo === el) activeVideo = null;
  };
}
