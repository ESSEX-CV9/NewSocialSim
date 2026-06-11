import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { ErrorBox, Spinner } from '../../components/Feedback';
import { SimClockDisplay } from '../../components/SimClockDisplay';
import { useI18n } from '../../i18n/I18nContext';
import { useWorld } from '../../world/WorldContext';
import { inputClass } from '../auth/LoginPage';

function CreateWorldForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    id: '',
    name: '',
    description: '',
    locale: 'zh-CN' as 'zh-CN' | 'en',
    scale: '1',
    calendarLabel: '公历',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createWorld({
        id: form.id,
        name: form.name,
        description: form.description,
        locale: form.locale,
        clock: { scale: Number(form.scale) || 1 },
        calendar: { label: form.calendarLabel || '公历' },
      });
      setForm({ id: '', name: '', description: '', locale: 'zh-CN', scale: '1', calendarLabel: '公历' });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 border-b border-gray-800 p-4">
      <h2 className="font-bold">{t('worlds.create')}</h2>
      <input value={form.id} onChange={set('id')} placeholder={t('worlds.id')} className={inputClass} />
      <input value={form.name} onChange={set('name')} placeholder={t('worlds.name')} className={inputClass} />
      <textarea
        value={form.description}
        onChange={set('description')}
        placeholder={t('worlds.desc')}
        rows={2}
        className={inputClass}
      />
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm text-gray-400">
          {t('worlds.locale')}
          <select value={form.locale} onChange={set('locale')} className={inputClass}>
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm text-gray-400">
          {t('worlds.scale')}
          <input value={form.scale} onChange={set('scale')} type="number" min="0.1" step="any" className={inputClass} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm text-gray-400">
          {t('worlds.calendarLabel')}
          <input value={form.calendarLabel} onChange={set('calendarLabel')} className={inputClass} />
        </label>
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <button
        type="submit"
        disabled={busy || !form.id || !form.name}
        className="self-end rounded-full bg-sky-500 px-5 py-1.5 font-bold text-white disabled:opacity-50"
      >
        {t('worlds.submit')}
      </button>
    </form>
  );
}

export function WorldsPage() {
  const { t } = useI18n();
  const { world, refresh } = useWorld();
  const { logout } = useAuth();
  const queryClient = useQueryClient();

  const worlds = useQuery({ queryKey: ['worlds'], queryFn: api.listWorlds });

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['worlds'] });
    void refresh();
  };

  const activate = async (id: string) => {
    if (!window.confirm(t('worlds.confirmSwitch'))) return;
    await api.activateWorld(id);
    // 切换世界后旧 token 必然失效：主动登出并刷新全部数据
    logout();
    queryClient.clear();
    reload();
  };

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-gray-800 bg-black/80 p-3 font-bold backdrop-blur">
        {t('worlds.title')}
      </div>

      <div className="border-b border-gray-800 p-4">
        <h2 className="mb-2 font-bold text-gray-300">{t('worlds.activeWorld')}</h2>
        {world ? (
          <div className="flex flex-col gap-1 text-sm text-gray-400">
            <div className="text-xl font-bold text-gray-100">
              {world.meta.name} <span className="text-sm text-gray-500">({world.meta.id})</span>
            </div>
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
          <div className="text-gray-500">{t('worlds.noActive')}</div>
        )}
      </div>

      <CreateWorldForm onCreated={reload} />

      <div className="p-4">
        <h2 className="mb-3 font-bold text-gray-300">{t('worlds.list')}</h2>
        {worlds.isLoading && <Spinner />}
        {worlds.isError && <ErrorBox error={worlds.error} />}
        <div className="flex flex-col gap-3">
          {worlds.data?.worlds.map((w) => (
            <div key={w.id} className="flex items-center gap-3 rounded-xl border border-gray-800 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {w.name} <span className="text-sm font-normal text-gray-500">({w.id})</span>
                </div>
                {w.description && <div className="truncate text-sm text-gray-500">{w.description}</div>}
              </div>
              {w.active ? (
                <span className="rounded-full bg-green-900/50 px-3 py-1 text-sm text-green-400">
                  {t('worlds.activeBadge')}
                </span>
              ) : (
                <button
                  onClick={() => void activate(w.id)}
                  className="rounded-full border border-gray-700 px-3 py-1 text-sm hover:bg-gray-900"
                >
                  {t('worlds.activate')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
