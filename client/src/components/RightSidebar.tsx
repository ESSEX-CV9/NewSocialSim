import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { UserSummary } from '@socialsim/shared';
import { api } from '../api/endpoints';
import { useFormatCount } from '../i18n/formatCount';
import { useI18n } from '../i18n/I18nContext';
import { useWorld } from '../world/WorldContext';
import { Avatar } from './Avatar';
import { SimClockDisplay } from './SimClockDisplay';

/** 右边栏"有什么新鲜事"：近期 #话题 排行 */
function TrendsCard() {
  const { t } = useI18n();
  const fmt = useFormatCount();
  const navigate = useNavigate();
  const trends = useQuery({
    queryKey: ['trends'],
    queryFn: api.trends,
    refetchInterval: 60_000,
  });

  if (!trends.data) return null;
  return (
    <section className="rounded-2xl bg-x-card pt-3 pb-1">
      <h2 className="px-4 pb-1 text-xl font-extrabold">{t('trends.title')}</h2>
      {trends.data.trends.length === 0 ? (
        <p className="px-4 py-3 text-[14px] text-x-dim">{t('trends.empty')}</p>
      ) : (
        trends.data.trends.map((item) => (
          <button
            key={item.tag.toLowerCase()}
            onClick={() => navigate(`/search?q=${encodeURIComponent(item.tag)}&type=posts`)}
            className="w-full px-4 py-3 text-left transition-colors duration-200 hover:bg-x-hover"
          >
            <div className="text-[13px] text-x-dim">{t('trends.trending')}</div>
            <div className="text-[15px] font-bold text-x-text">{item.tag}</div>
            <div className="text-[13px] text-x-dim">{t('trends.postCount', { n: fmt(item.postCount) })}</div>
          </button>
        ))
      )}
    </section>
  );
}

/** 右边栏"推荐关注"：与首页空关注流的内联版独立（布局不同） */
function WhoToFollowCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const suggestions = useQuery({ queryKey: ['suggested-users'], queryFn: api.suggestedUsers });
  const [followed, setFollowed] = useState<Set<number>>(new Set());

  const follow = async (u: UserSummary) => {
    await api.follow(u.handle);
    setFollowed((prev) => new Set(prev).add(u.id));
    void queryClient.invalidateQueries({ queryKey: ['timeline'] });
  };

  if (!suggestions.data || suggestions.data.users.length === 0) return null;
  return (
    <section className="rounded-2xl bg-x-card pt-3 pb-1">
      <h2 className="px-4 pb-1 text-xl font-extrabold">{t('timeline.suggestions')}</h2>
      {suggestions.data.users.map((u) => (
        <div
          key={u.id}
          className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-x-hover"
        >
          <Link to={`/u/${u.handle}`} className="self-start">
            <Avatar handle={u.handle} avatarUrl={u.avatarUrl} size={40} />
          </Link>
          <Link to={`/u/${u.handle}`} className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold hover:underline">{u.displayName}</div>
            <div className="truncate text-[14px] text-x-dim">@{u.handle}</div>
          </Link>
          <button
            onClick={() => void follow(u)}
            disabled={followed.has(u.id)}
            className="rounded-full bg-x-text px-4 py-1.5 text-[14px] font-bold text-x-bg transition-opacity duration-200 hover:opacity-90 disabled:opacity-50"
          >
            {t('profile.follow')}
          </button>
        </div>
      ))}
    </section>
  );
}

/** 默认折叠的"当前世界"卡：折叠态只露世界名与跳动时钟 */
function WorldCard() {
  const { world } = useWorld();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  if (!world) {
    return (
      <section className="rounded-2xl bg-x-card p-4 text-[14px] text-x-dim">
        {t('worlds.noActive')} —{' '}
        <Link to="/worlds" className="text-x-blue hover:underline">
          {t('auth.goWorlds')}
        </Link>
      </section>
    );
  }
  return (
    <section
      onClick={() => setExpanded((v) => !v)}
      className="cursor-pointer rounded-2xl bg-x-card p-4 transition-colors duration-200 hover:bg-x-hover"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[15px] font-bold text-x-text">
          <i className="ri-earth-fill text-[16px] text-x-blue" />
          {world.meta.name}
        </div>
        <i className={`${expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-[18px] text-x-dim`} />
      </div>
      <div className="mt-1.5 text-[13px] text-x-dim">
        <SimClockDisplay />
      </div>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5 text-[14px] text-x-dim">
          {world.meta.description && <p>{world.meta.description}</p>}
          <div>
            {t('worlds.speed')}:{' '}
            {world.meta.clock.paused
              ? t('worlds.paused')
              : t('worlds.speedValue', { scale: world.meta.clock.scale })}
          </div>
        </div>
      )}
    </section>
  );
}

/** 装饰性页脚（拟真用，链接无动作） */
function SidebarFooter() {
  const { t } = useI18n();
  const links = [t('footer.tos'), t('footer.privacy'), t('footer.cookies')];
  return (
    <nav className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-6 text-[13px] text-x-dim">
      {links.map((label) => (
        <a key={label} href="#" onClick={(e) => e.preventDefault()} className="hover:underline">
          {label}
        </a>
      ))}
      <span>© 2026 {t('app.name')}</span>
    </nav>
  );
}

export function RightSidebar() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <>
      {/* 列内吸顶：滚动时搜索框始终可用 */}
      <form onSubmit={submitSearch} className="sticky top-0 z-10 bg-x-bg pt-3 pb-1">
        <i className="ri-search-line absolute top-1/2 left-4 mt-1 -translate-y-1/2 text-[14px] text-x-dim" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search.placeholder')}
          className="w-full rounded-full border border-transparent bg-x-input py-2.5 pr-4 pl-11 text-[15px] outline-none placeholder:text-x-dim focus:border-x-blue focus:bg-x-bg"
        />
      </form>
      <TrendsCard />
      <WhoToFollowCard />
      <WorldCard />
      <SidebarFooter />
    </>
  );
}
