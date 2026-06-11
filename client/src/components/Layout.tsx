import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useWorld } from '../world/WorldContext';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { SimClockDisplay } from './SimClockDisplay';

function NavItem({
  to,
  icon,
  activeIcon,
  label,
  badge,
}: {
  to: string;
  icon: string;
  activeIcon?: string | undefined;
  label: string;
  badge?: number | undefined;
}) {
  return (
    <NavLink to={to} className="group flex w-fit min-[800px]:w-full">
      {({ isActive }) => (
        <span
          className={`flex items-center gap-5 rounded-full p-3 text-xl transition-colors duration-200 group-hover:bg-x-input min-[800px]:px-4 min-[800px]:py-2.5 ${
            isActive ? 'font-bold' : ''
          }`}
        >
          <span className="relative flex w-6 justify-center">
            <i className={`${isActive && activeIcon ? activeIcon : icon} text-[22px]`} />
            {badge !== undefined && badge > 0 && (
              <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-x-blue px-1 text-[10px] font-bold text-white">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          <span className="hidden text-[17px] min-[800px]:inline">{label}</span>
        </span>
      )}
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, otherAccounts, switchAccount, logout } = useAuth();
  const { world } = useWorld();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: api.unreadCount,
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const handleSwitchAccount = async (index: number) => {
    setAccountMenuOpen(false);
    await switchAccount(index);
    queryClient.clear();
    navigate('/');
  };

  const handleLogout = () => {
    setAccountMenuOpen(false);
    logout();
    queryClient.clear();
    navigate('/');
  };

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl">
      {/* 左栏：导航 */}
      <header className="sticky top-0 flex h-screen w-18 flex-col items-center px-2 py-1 min-[800px]:w-68.75 min-[800px]:items-stretch">
        <Link
          to="/"
          className="flex w-fit items-center gap-3 rounded-full p-3 text-2xl font-extrabold text-x-text transition-colors duration-200 hover:bg-x-input"
        >
          <i className="ri-base-station-fill text-x-blue" />
          <span className="hidden min-[800px]:inline">{t('app.name')}</span>
        </Link>
        <nav className="mt-1 flex flex-col items-center gap-5 min-[800px]:items-stretch">
          <NavItem to="/" icon="ri-home-5-line" activeIcon="ri-home-5-fill" label={t('nav.home')} />
          <NavItem
            to="/search"
            icon="ri-search-line"
            activeIcon="ri-search-fill"
            label={t('nav.explore')}
          />
          {user && (
            <NavItem
              to="/notifications"
              icon="ri-notification-2-line"
              activeIcon="ri-notification-2-fill"
              label={t('nav.notifications')}
              badge={unread.data?.count}
            />
          )}
          {user && (
            <NavItem
              to="/bookmarks"
              icon="ri-bookmark-line"
              activeIcon="ri-bookmark-fill"
              label={t('nav.bookmarks')}
            />
          )}
          {user && (
            <NavItem
              to={`/u/${user.handle}`}
              icon="ri-user-line"
              activeIcon="ri-user-fill"
              label={t('nav.profile')}
            />
          )}
          <NavItem to="/worlds" icon="ri-earth-line" activeIcon="ri-earth-fill" label={t('nav.worlds')} />
        </nav>
        {user && (
          <button
            onClick={() => setComposeOpen(true)}
            className="mt-4 hidden w-[90%] rounded-full bg-x-blue py-3.5 text-[17px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark min-[800px]:block"
          >
            {t('composer.send')}
          </button>
        )}
        <div className="relative mt-auto mb-2 flex flex-col items-center gap-2 min-[800px]:items-stretch min-[800px]:p-2">
          {user ? (
            <>
              <button
                onClick={() => setAccountMenuOpen((v) => !v)}
                className="flex w-full items-center gap-3 rounded-full p-2 text-left transition-colors duration-200 hover:bg-x-input"
              >
                <Avatar handle={user.handle} size={40} />
                <div className="hidden min-w-0 flex-1 min-[800px]:block">
                  <div className="truncate text-[15px] font-bold">{user.displayName}</div>
                  <div className="truncate text-[13px] text-x-dim">@{user.handle}</div>
                </div>
                <i className="ri-more-fill hidden px-1 text-[18px] text-x-text min-[800px]:inline" />
              </button>
              {accountMenuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setAccountMenuOpen(false)} />
                  <div className="absolute bottom-full left-0 z-30 mb-2 w-64 overflow-hidden rounded-2xl border border-x-border bg-x-card py-2 shadow-lg">
                    {otherAccounts.map((account) => (
                      <button
                        key={account.user.id}
                        onClick={() => void handleSwitchAccount(account.index)}
                        className="flex w-full items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-x-input"
                      >
                        <Avatar handle={account.user.handle} size={32} />
                        <div className="min-w-0 flex-1 text-left">
                          <div className="truncate text-[15px] font-bold">
                            {account.user.displayName}
                          </div>
                          <div className="truncate text-[13px] text-x-dim">
                            @{account.user.handle}
                          </div>
                        </div>
                      </button>
                    ))}
                    {otherAccounts.length > 0 && <div className="my-1 border-t border-x-border" />}
                    <button
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/login?add=1');
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold transition-colors duration-200 hover:bg-x-input"
                    >
                      <i className="ri-user-add-line text-[18px]" />
                      {t('account.add')}
                    </button>
                    <button
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/settings');
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold transition-colors duration-200 hover:bg-x-input"
                    >
                      <i className="ri-settings-3-line text-[18px]" />
                      {t('account.settings')}
                    </button>
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold text-x-red transition-colors duration-200 hover:bg-x-input"
                    >
                      <i className="ri-logout-box-r-line text-[18px]" />
                      {t('account.logoutOf', { handle: user.handle })}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <Link
              to="/login"
              className="rounded-full bg-x-blue px-4 py-2.5 text-center font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark"
            >
              <span className="hidden min-[800px]:inline">{t('nav.login')}</span>
              <i className="ri-login-box-line min-[800px]:hidden" />
            </Link>
          )}
        </div>
      </header>

      {/* 中栏：内容 */}
      <main className="min-h-screen w-full max-w-150 border-x border-x-border">{children}</main>

      {/* 右栏：搜索 + 世界信息 */}
      <aside className="sticky top-0 hidden h-screen w-87.5 flex-col gap-4 px-6 py-3 min-[1100px]:flex">
        <form onSubmit={submitSearch} className="relative">
          <i className="ri-search-line absolute top-1/2 left-4 -translate-y-1/2 text-[14px] text-x-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
            className="w-full rounded-full border border-transparent bg-x-input py-2.5 pr-4 pl-11 text-[15px] outline-none placeholder:text-x-dim focus:border-x-blue focus:bg-x-bg"
          />
        </form>
        <div className="rounded-2xl bg-x-card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-xl font-extrabold">
            <i className="ri-earth-fill text-[16px] text-x-blue" />
            {t('worlds.activeWorld')}
          </h2>
          {world ? (
            <div className="flex flex-col gap-1.5 text-[14px] text-x-dim">
              <div className="text-[17px] font-bold text-x-text">{world.meta.name}</div>
              {world.meta.description && <p>{world.meta.description}</p>}
              <SimClockDisplay />
              <div>
                {t('worlds.speed')}:{' '}
                {world.meta.clock.paused
                  ? t('worlds.paused')
                  : t('worlds.speedValue', { scale: world.meta.clock.scale })}
              </div>
            </div>
          ) : (
            <div className="text-[14px] text-x-dim">
              {t('worlds.noActive')} —{' '}
              <Link to="/worlds" className="text-x-blue hover:underline">
                {t('auth.goWorlds')}
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* 发帖弹窗 */}
      {composeOpen && (
        <div
          onClick={() => setComposeOpen(false)}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl border border-x-border bg-x-bg"
          >
            <div className="flex items-center p-2">
              <button
                onClick={() => setComposeOpen(false)}
                className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
              >
                <i className="ri-close-line text-[18px]" />
              </button>
            </div>
            <Composer
              placeholder={t('composer.placeholder')}
              buttonText={t('composer.send')}
              autoFocus
              bordered={false}
              onPosted={(p) => {
                setComposeOpen(false);
                navigate(`/post/${p.id}`);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
