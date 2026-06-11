import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { useWorld } from '../../world/WorldContext';

export function AuthFormShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-x-border bg-x-card p-8">
        <div className="mb-4 text-3xl text-x-blue">
          <i className="ri-base-station-fill" />
        </div>
        <h1 className="mb-6 text-2xl font-extrabold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-transparent bg-x-input px-3 py-2.5 text-[15px] outline-none placeholder:text-x-dim focus:border-x-blue';
export const buttonClass =
  'w-full rounded-full bg-x-blue py-2.5 text-[15px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:cursor-not-allowed disabled:opacity-50';

export function LoginPage() {
  const { login } = useAuth();
  const { world } = useWorld();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ handle, password });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!world) {
    return (
      <AuthFormShell title={t('app.name')}>
        <p className="mb-4 text-[15px] text-x-dim">{t('auth.noWorld')}</p>
        <Link to="/worlds" className="text-[15px] text-x-blue hover:underline">
          {t('auth.goWorlds')}
        </Link>
      </AuthFormShell>
    );
  }

  return (
    <AuthFormShell title={t('auth.loginTitle', { world: world.meta.name })}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder={t('auth.handle')}
          autoFocus
          className={inputClass}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.password')}
          className={inputClass}
        />
        {error && <div className="text-sm text-x-red">{error}</div>}
        <button type="submit" disabled={busy || !handle || !password} className={buttonClass}>
          {t('auth.login')}
        </button>
      </form>
      <Link to="/register" className="mt-4 block text-sm text-x-blue hover:underline">
        {t('auth.noAccount')}
      </Link>
    </AuthFormShell>
  );
}
