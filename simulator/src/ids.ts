/**
 * 帖子 id 规整：把来自 API 的 id（可能是数字、字符串、或某些路径下的浮点表示如 "3193.0"）
 * 统一成规范整数串 "3193"。社交站全站流在 UNION 转发行时 id 可能以浮点形态返回，
 * 直接 String() 会得到 "3193.0"，导致轨迹的 target_post_id 与帖子块 id 对不上（决策轨迹"为什么"丢失）。
 */
export function idStr(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(v);
}
