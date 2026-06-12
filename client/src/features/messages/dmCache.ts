import type { MessageView, Page } from '@socialsim/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

/** 把新消息插入会话消息缓存第一页头部（列表为倒序存储）；缓存不存在或已含该消息时不动 */
export function prependDmMessage(
  queryClient: QueryClient,
  conversationId: number,
  message: MessageView,
): void {
  const key = ['dm-messages', conversationId];
  const data = queryClient.getQueryData<InfiniteData<Page<MessageView>>>(key);
  if (!data || data.pages.length === 0) return;
  if (data.pages.some((p) => p.items.some((m) => m.id === message.id))) return;
  const first = data.pages[0]!;
  queryClient.setQueryData(key, {
    ...data,
    pages: [{ ...first, items: [message, ...first.items] }, ...data.pages.slice(1)],
  });
}
