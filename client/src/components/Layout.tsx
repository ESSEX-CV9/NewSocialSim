import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useWorld } from '../world/WorldContext';
import { Avatar } from './Avatar';
import { SimClockDisplay } from './SimClockDisplay';

function NavItem({
  to,
  icon,
  label,
  badge,
}: {
  to: string;
  icon: string;
  label: string;
  badge?: number | undefined;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-full px-4 py-2.5 text-lg hover:bg-gray-900 ${isActive ? 'font-bold' : ''}`
      }
    >
      <span className="relative">
        {icon}
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-bold text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="hidden xl:inline">{label}</span>
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { world } = useWorld();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: api.unreadCount,
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl">
      {/* 左栏：导航 */}
      <header className="sticky top-0 flex h-screen w-16 flex-col border-r border-gray-800 p-2 xl:w-64">
        <Link to="/" className="mb-4 px-4 py-2 text-xl font-bold text-sky-500">
          <span className="xl:hidden">S</span>
          <span className="hidden xl:inline">{t('app.name')}</span>
        </Link>
        <nav className="flex flex-col gap-1">
          <NavItem to="/" icon="🏠" label={t('nav.home')} />
          {user && (
            <NavItem to="/notifications" icon="🔔" label={t('nav.notifications')} badge={unread.data?.count} />
          )}
          <NavItem to="/search" icon="🔍" label={t('nav.search')} />
          {user && <NavItem to={`/u/${user.handle}`} icon="👤" label={t('nav.profile')} />}
          <NavItem to="/worlds" icon="🌍" label={t('nav.worlds')} />
        </nav>
        <div className="mt-auto flex flex-col gap-2 p-2">
          <button
            onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
            className="self-start rounded-full px-3 py-1 text-sm text-gray-400 hover:bg-gray-900"
          >
            {locale === 'zh-CN' ? 'EN' : '中文'}
          </button>
          {user ? (
            <div className="flex items-center gap-2">
              <Avatar handle={user.handle} size={36} />
              <div className="hidden min-w-0 flex-1 xl:block">
                <div className="truncate text-sm font-bold">{user.displayName}</div>
                <div className="truncate text-xs text-gray-500">@{user.handle}</div>
              </div>
              <button
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
                title={t('nav.logout')}
                className="rounded-full px-2 py-1 text-sm text-gray-400 hover:bg-gray-900"
              >
                ⏏
              </button>
            </div>
          ) : (
            <Link to="/login" className="rounded-full bg-sky-500 px-4 py-2 text-center font-bold text-white">
              {t('nav.login')}
            </Link>
          )}
        </div>
      </header>

      {/* 中栏：内容 */}
      <main className="min-h-screen w-full max-w-xl border-r border-gray-800">{children}</main>

      {/* 右栏：搜索 + 世界信息 */}
      <aside className="sticky top-0 hidden h-screen flex-1 flex-col gap-4 p-4 lg:flex">
        <form onSubmit={submitSearch}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
            className="w-full rounded-full border border-gray-800 bg-gray-950 px-4 py-2 outline-none focus:border-sky-500"
          />
        </form>
        <div className="rounded-2xl border border-gray-800 bg-gray-950 p-4">
          <h2 className="mb-2 font-bold text-gray-300">{t('worlds.activeWorld')}</h2>
          {world ? (
            <div className="flex flex-col gap-1 text-sm text-gray-400">
              <div className="text-lg font-bold text-gray-100">{world.meta.name}</div>
              {world.meta.description && <p className="text-gray-500">{world.meta.description}</p>}
              <SimClockDisplay />
              <div>
                {t('worlds.speed')}:{' '}
                {world.meta.clock.paused
                  ? t('worlds.paused')
                  : t('worlds.speedValue', { scale: world.meta.clock.scale })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              {t('worlds.noActive')} —{' '}
              <Link to="/worlds" className="text-sky-500 hover:underline">
                {t('auth.goWorlds')}
              </Link>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
