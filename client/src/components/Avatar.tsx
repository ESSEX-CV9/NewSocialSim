/** 无图片上传，头像 = handle 哈希出的颜色 + 首字母 */
export function Avatar({ handle, size = 40 }: { handle: string; size?: number }) {
  let hash = 0;
  for (const ch of handle) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        backgroundColor: `hsl(${hash}, 55%, 45%)`,
      }}
    >
      {handle.slice(0, 1).toUpperCase()}
    </div>
  );
}
