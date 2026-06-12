import type { Page } from '@socialsim/shared';
import { useInfiniteQuery } from '@tanstack/react-query';

/** 游标分页查询的统一封装：所有列表（时间线/回复/通知/搜索）共用 */
export function usePagedQuery<T>(
  key: readonly unknown[],
  fetcher: (cursor?: string) => Promise<Page<T>>,
  options?: {
    enabled?: boolean;
    refetchOnMount?: boolean | 'always';
    refetchInterval?: number | false;
    staleTime?: number;
  },
) {
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetcher(pageParam === '' ? undefined : pageParam),
    initialPageParam: '',
    getNextPageParam: (last: Page<T>) => last.nextCursor ?? undefined,
    enabled: options?.enabled ?? true,
    ...(options?.refetchOnMount !== undefined ? { refetchOnMount: options.refetchOnMount } : {}),
    ...(options?.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
    ...(options?.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
  });

  return {
    ...query,
    items: query.data?.pages.flatMap((p) => p.items) ?? [],
  };
}
