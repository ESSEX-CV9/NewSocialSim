import type { SimTraceAction } from '@socialsim/shared';

/** 轨迹动作 → 颜色令牌，使时间轴/检视器一眼区分发帖/回复/赞等。 */
export const ACTION_COLOR: Record<SimTraceAction, string> = {
  post: 'var(--blue)',
  reply: 'var(--green)',
  quote: 'var(--amber)',
  like: 'var(--pink)',
  repost: '#a970ff',
  follow: 'var(--dim)',
};

export const ACTION_LABEL: Record<SimTraceAction, string> = {
  post: '发帖', reply: '回复', quote: '引用', like: '赞', repost: '转发', follow: '关注',
};

export function formatSimTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 账号头像配色：按 handle 哈希取一个固定色，使每个账号有稳定可辨识的色块。 */
const AVATAR_PALETTE = ['#1d9bf0', '#f91880', '#00ba7c', '#f5a623', '#a970ff', '#ff7a45', '#17bf63', '#e0245e'];
export function avatarColor(handle: string): string {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]!;
}
