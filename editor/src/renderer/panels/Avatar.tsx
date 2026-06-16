import { avatarColor } from './trace-meta.js';

/** 账号头像：彩色圆形 + handle 首字母（大写）。颜色按 handle 哈希稳定取色。 */
export function Avatar({ handle, size = 18 }: { handle: string; size?: number }) {
  return (
    <span
      className="rounded-full flex items-center justify-center text-white font-bold flex-none"
      style={{ background: avatarColor(handle), width: size, height: size, fontSize: Math.round(size * 0.52) }}
    >
      {handle.charAt(0).toUpperCase() || '?'}
    </span>
  );
}
