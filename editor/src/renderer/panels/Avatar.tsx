import { avatarColor } from './trace-meta.js';

/**
 * 账号头像：彩色圆形 + 首字母。颜色按 handle 哈希稳定取；字符优先用昵称首字（如「林」），
 * 无昵称则回落 handle 首字母。
 */
export function Avatar({ handle, name, size = 18 }: { handle: string; name?: string; size?: number }) {
  const ch = (name && name.charAt(0)) || handle.charAt(0).toUpperCase() || '?';
  return (
    <span
      className="rounded-full flex items-center justify-center text-white font-bold flex-none"
      style={{ background: avatarColor(handle), width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      {ch}
    </span>
  );
}
