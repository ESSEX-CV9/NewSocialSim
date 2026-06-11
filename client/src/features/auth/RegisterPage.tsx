import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { AuthFormShell, buttonClass, inputClass } from './LoginPage';

export function RegisterPage() {
  const { register } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const addMode = params.get('add') === '1';
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ handle, displayName, password }, { append: addMode });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFormShell title={t('auth.registerTitle')}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder={t('auth.handle')}
          autoFocus
          className={inputClass}
        />
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('auth.displayName')}
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
        <button
          type="submit"
          disabled={busy || !handle || !displayName || !password}
          className={buttonClass}
        >
          {t('auth.register')}
        </button>
      </form>
      <Link
        to={addMode ? '/login?add=1' : '/login'}
        className="mt-4 block text-sm text-x-blue hover:underline"
      >
        {t('auth.haveAccount')}
      </Link>
    </AuthFormShell>
  );
}
