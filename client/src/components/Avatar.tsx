/** 头像：有上传图用图片，否则 handle 哈希出的颜色 + 首字母 */
export function Avatar({
  handle,
  avatarUrl,
  size = 40,
}: {
  handle: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={handle}
        className="shrink-0 rounded-full object-cover select-none"
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
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
