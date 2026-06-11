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
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 border-b border-x-border p-4">
      <h2 className="flex items-center gap-2 text-[17px] font-bold">
        <i className="ri-add-circle-line text-x-blue" />
        {t('worlds.create')}
      </h2>
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
        <label className="flex flex-1 flex-col gap-1 text-[13px] text-x-dim">
          {t('worlds.locale')}
          <select value={form.locale} onChange={set('locale')} className={inputClass}>
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[13px] text-x-dim">
          {t('worlds.scale')}
          <input value={form.scale} onChange={set('scale')} type="number" min="0.1" step="any" className={inputClass} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[13px] text-x-dim">
          {t('worlds.calendarLabel')}
          <input value={form.calendarLabel} onChange={set('calendarLabel')} className={inputClass} />
        </label>
      </div>
      {error && <div className="text-sm text-x-red">{error}</div>}
      <button
        type="submit"
        disabled={busy || !form.id || !form.name}
        className="self-end rounded-full bg-x-blue px-5 py-1.5 text-[15px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
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
      <div className="glass-header px-4 py-3 text-[17px] font-bold">{t('worlds.title')}</div>

      <div className="border-b border-x-border p-4">
        <h2 className="mb-2 flex items-center gap-2 text-[17px] font-bold">
          <i className="ri-earth-fill text-x-blue" />
          {t('worlds.activeWorld')}
        </h2>
        {world ? (
          <div className="flex flex-col gap-1.5 rounded-2xl bg-x-card p-4 text-[14px] text-x-dim">
            <div className="text-xl font-bold text-x-text">
              {world.meta.name} <span className="text-sm font-normal text-x-dim">({world.meta.id})</span>
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
          <div className="text-[15px] text-x-dim">{t('worlds.noActive')}</div>
        )}
      </div>

      <CreateWorldForm onCreated={reload} />

      <div className="p-4">
        <h2 className="mb-3 text-[17px] font-bold">{t('worlds.list')}</h2>
        {worlds.isLoading && <Spinner />}
        {worlds.isError && <ErrorBox error={worlds.error} />}
        <div className="flex flex-col gap-3">
          {worlds.data?.worlds.map((w) => (
            <div
              key={w.id}
              className="flex items-center gap-3 rounded-2xl border border-x-border p-4 transition-colors duration-200 hover:bg-x-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">
                  {w.name} <span className="text-sm font-normal text-x-dim">({w.id})</span>
                </div>
                {w.description && <div className="truncate text-sm text-x-dim">{w.description}</div>}
              </div>
              {w.active ? (
                <span className="flex items-center gap-1.5 rounded-full bg-x-green/15 px-3 py-1 text-sm font-bold text-x-green">
                  <i className="ri-circle-fill text-[6px]" />
                  {t('worlds.activeBadge')}
                </span>
              ) : (
                <button
                  onClick={() => void activate(w.id)}
                  className="rounded-full border border-x-dim px-3 py-1 text-sm font-bold transition-colors duration-200 hover:bg-x-input"
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
