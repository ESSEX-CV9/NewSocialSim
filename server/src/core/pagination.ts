/**
 * 游标分页工具：游标是若干排序键的 base64url(JSON 数组)。
 * 对客户端不透明，服务端各模块自行约定数组内容。
 */
export function encodeCursor(parts: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/** 解析失败（伪造/损坏的游标）返回 null，调用方按"第一页"处理 */
export function decodeCursor(cursor: string | undefined): unknown[] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 常见形态：[时间戳, id] 两段数字游标 */
export function decodeTsIdCursor(cursor: string | undefined): { ts: number; id: number } | null {
  const parts = decodeCursor(cursor);
  if (!parts || parts.length !== 2) return null;
  const [ts, id] = parts;
  if (typeof ts !== 'number' || typeof id !== 'number') return null;
  return { ts, id };
}
