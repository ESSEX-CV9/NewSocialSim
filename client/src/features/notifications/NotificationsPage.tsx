import type { NotificationView, UserSummary } from '@socialsim/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { EmptyBox, ErrorBox, Spinner } from '../../components/Feedback';
import { LoadMore } from '../../components/LoadMore';
import { TimeAgo } from '../../components/TimeAgo';
import { usePagedQuery } from '../../components/usePagedQuery';
import { useFormatCount } from '../../i18n/formatCount';
import { useI18n } from '../../i18n/I18nContext';
import type { MessageKey } from '../../i18n/messages';

const TYPE_ICONS: Record<NotificationView['type'], { icon: string; color: string }> = {
  reply: { icon: 'ri-chat-3-line', color: 'text-x-blue' },
  quote: { icon: 'ri-double-quotes-l', color: 'text-x-blue' },
  like: { icon: 'ri-heart-3-fill', color: 'text-x-pink' },
  repost: { icon: 'ri-repeat-2-fill', color: 'text-x-green' },
  follow: { icon: 'ri-user-add-fill', color: 'text-x-blue' },
  mention: { icon: 'ri-at-line', color: 'text-x-blue' },
};

type Filter = 'all' | 'mentions';

/** 聚合后的展示单元 */
interface NotificationGroup {
  key: string;
  items: NotificationView[];
}

/**
 * 客户端聚合（纯展示层）：
 * - like/repost：相邻同类型且（同 actor 或 同帖子）合并
 * - follow：相邻的全部合并
 * - reply/quote/mention：不合并
 */
function groupNotifications(items: NotificationView[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  for (const n of items) {
    const last = groups[groups.length - 1];
    const first = last?.items[0];
    const canMerge =
      first !== undefined &&
      first.type === n.type &&
      ((n.type === 'follow' && true) ||
        ((n.type === 'like' || n.type === 'repost') &&
          (first.actor.id === n.actor.id ||
            (first.postId !== null && first.postId === n.postId))));
    if (canMerge && last) {
      last.items.push(n);
    } else {
      groups.push({ key: `g-${n.id}`, items: [n] });
    }
  }
  return groups;
}

interface RankedActor {
  user: UserSummary;
  followerCount: number;
  followed: boolean;
  /** 在通知列表中的原始位置（越小越新） */
  order: number;
}

/** 组内 actor 去重并按重要度排序：被我关注 > 粉丝多 > 最新 */
function rankActors(items: NotificationView[]): RankedActor[] {
  const map = new Map<number, RankedActor>();
  items.forEach((n, i) => {
    if (!map.has(n.actor.id)) {
      map.set(n.actor.id, {
        user: n.actor,
        followerCount: n.actorFollowerCount,
        followed: n.actorFollowedByViewer,
        order: i,
      });
    }
  });
  return [...map.values()].sort(
    (a, b) =>
      Number(b.followed) - Number(a.followed) ||
      b.followerCount - a.followerCount ||
      a.order - b.order,
  );
}

/** X 式头像堆叠：领头完整在最上层，后续各遮一半，尾部渐变淡出，最多 4 个 */
function AvatarStack({ actors }: { actors: RankedActor[] }) {
  const shown = actors.slice(0, 4);
  const OPACITY = ['', '', 'opacity-60', 'opacity-30'];
  if (shown.length === 1) {
    return <Avatar handle={shown[0]!.user.handle} avatarUrl={shown[0]!.user.avatarUrl} size={32} />;
  }
  // 人越多叠得越紧：2 人露一半，3 人露 12px，4 人只露 8px
  const overlap = shown.length >= 4 ? '-ml-6' : shown.length === 3 ? '-ml-5' : '-ml-4';
  return (
    <div className="flex items-center">
      {shown.map((a, i) => (
        <div
          key={a.user.id}
          className={`relative rounded-full border-2 border-x-bg ${i > 0 ? overlap : ''} ${OPACITY[i] ?? ''}`}
          style={{ zIndex: shown.length - i }}
        >
          <Avatar handle={a.user.handle} avatarUrl={a.user.avatarUrl} size={32} />
        </div>
      ))}
    </div>
  );
}

function groupText(
  group: NotificationGroup,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  fmt: (n: number) => string,
): string {
  const first = group.items[0]!;
  if (group.items.length === 1) return t(`notif.${first.type}`);

  const distinctActors = new Set(group.items.map((n) => n.actor.id)).size;
  if (first.type === 'follow') {
    return distinctActors > 1
      ? t('notif.followMany', { n: fmt(distinctActors - 1) })
      : t('notif.follow');
  }
  // like / repost
  if (distinctActors > 1) {
    return t(first.type === 'like' ? 'notif.likeManyActors' : 'notif.repostManyActors', {
      n: fmt(distinctActors - 1),
    });
  }
  const distinctPosts = new Set(group.items.map((n) => n.postId)).size;
  return t(first.type === 'like' ? 'notif.likeManyPosts' : 'notif.repostManyPosts', {
    n: fmt(distinctPosts),
  });
}

export function NotificationsPage() {
  const { t } = useI18n();
  const fmt = useFormatCount();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  // 进页必拉最新（未读徽标先于列表更新），停留期间与未读数轮询同节拍刷新
  const query = usePagedQuery(
    ['notifications', filter],
    (cursor) => api.notifications(cursor, filter),
    { refetchOnMount: 'always', refetchInterval: 30_000 },
  );

  const markAll = async () => {
    await api.markAllRead();
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
  };

  /** 点击通知组时把组内未读标为已读（不阻塞跳转） */
  const markGroupRead = (group: NotificationGroup) => {
    const unreadIds = group.items.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    void api.markRead(unreadIds).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    });
  };

  const tabClass = (active: boolean) =>
    `flex h-13.25 flex-1 cursor-pointer items-center justify-center text-[15px] font-medium transition-colors duration-200 hover:bg-x-hover ${
      active ? 'tab-active' : 'text-x-dim'
    }`;

  const groups = groupNotifications(query.items);

  const groupTarget = (group: NotificationGroup): string => {
    const first = group.items[0]!;
    if (first.type === 'follow') {
      return group.items.length > 1 && user
        ? `/u/${user.handle}/followers`
        : `/u/${first.actor.handle}`;
    }
    return first.postId !== null ? `/post/${first.postId}` : `/u/${first.actor.handle}`;
  };

  return (
    <div>
      <div className="glass-header">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-[17px] font-bold">{t('notif.title')}</span>
          <button
            onClick={() => void markAll()}
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-x-blue transition-colors duration-200 hover:bg-x-input"
          >
            <i className="ri-check-double-line" />
            {t('notif.markAllRead')}
          </button>
        </div>
        <div className="flex">
          <button className={tabClass(filter === 'all')} onClick={() => setFilter('all')}>
            {t('notif.tabAll')}
          </button>
          <button className={tabClass(filter === 'mentions')} onClick={() => setFilter('mentions')}>
            {t('notif.tabMentions')}
          </button>
        </div>
      </div>
      {query.isLoading && <Spinner />}
      {query.isError && <ErrorBox error={query.error} />}
      {groups.map((group) => {
        const first = group.items[0]!;
        const type = TYPE_ICONS[first.type];
        const unread = group.items.some((n) => !n.read);
        const actors = rankActors(group.items);
        const lead = actors[0]!;

        return (
          <Link key={group.key} to={groupTarget(group)} onClick={() => markGroupRead(group)}>
            <div
              className={`flex gap-3 border-b border-x-border px-4 py-3 transition-colors duration-200 hover:bg-x-hover ${
                unread ? 'border-l-2 border-l-x-blue bg-x-blue/5' : ''
              }`}
            >
              <i className={`${type.icon} ${type.color} w-8 shrink-0 text-center text-[26px] leading-none`} />
              <div className="min-w-0 flex-1">
                <AvatarStack actors={actors} />
                {/* 三层文字层级：动作文案最实 > 帖子摘要居中且更小 > 时间最浅 */}
                <div className="mt-2 text-[15px]">
                  <span className="font-bold">{lead.user.displayName}</span>{' '}
                  <span>{groupText(group, t, fmt)}</span>
                  <span className="text-x-dim">
                    {' '}
                    · <TimeAgo at={first.createdAt} />
                  </span>
                </div>
                {first.postExcerpt && (
                  <p className="mt-1 line-clamp-2 text-[13px] text-x-text/60">
                    {first.postExcerpt}
                  </p>
                )}
              </div>
            </div>
          </Link>
        );
      })}
      {query.isSuccess && query.items.length === 0 && (
        <EmptyBox icon="ri-notification-2-line" text={t('notif.empty')} />
      )}
      <LoadMore
        hasNextPage={!!query.hasNextPage}
        isFetching={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </div>
  );
}
