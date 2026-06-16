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
