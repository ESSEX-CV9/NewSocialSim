import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type PixivLoginStatus } from '../../api/endpoints';
import { useI18n } from '../../i18n/I18nContext';
import { inputClass } from '../auth/LoginPage';

/** 设置页"媒体搜索"区块：各源状态、Pixiv 引导登录、凭证与代理配置 */
export function MediaSearchSettings() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: ['media-search-sources'], queryFn: api.mediaSearchSources });
  const config = useQuery({ queryKey: ['media-search-config'], queryFn: api.mediaSearchConfig });

  const [login, setLogin] = useState<PixivLoginStatus | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [proxy, setProxy] = useState<string | null>(null);
  const [pinterestCookies, setPinterestCookies] = useState('');
  const [pexelsKey, setPexelsKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['media-search-sources'] });
    void queryClient.invalidateQueries({ queryKey: ['media-search-config'] });
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const startLogin = async () => {
    const status = await api.pixivLogin();
    setLogin(status);
    stopPolling();
    pollTimer.current = setInterval(() => {
      void api.pixivLoginStatus().then((s) => {
        setLogin(s);
        if (s.state === 'success' || s.state === 'error') {
          stopPolling();
          if (s.state === 'success') refreshAll();
        }
      });
    }, 2000);
  };

  const submitManualCode = async () => {
    if (!manualCode.trim()) return;
    try {
      const s = await api.pixivSubmitCode(manualCode.trim());
      setLogin(s);
      setManualCode('');
      if (s.state === 'success') refreshAll();
    } catch (e) {
      setLogin({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const patch: Record<string, unknown> = {};
      if (proxy !== null) patch['proxy'] = proxy.trim();
      if (pinterestCookies.trim()) patch['pinterest'] = { cookies: pinterestCookies.trim() };
      if (pexelsKey.trim()) patch['pexels'] = { apiKey: pexelsKey.trim() };
      if (Object.keys(patch).length === 0) return;
      await api.patchMediaSearchConfig(patch);
      setPinterestCookies('');
      setPexelsKey('');
      setSaveMsg(t('mediaSearch.saved'));
      refreshAll();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const loginStateText = (s: PixivLoginStatus): string => {
    switch (s.state) {
      case 'launching':
      case 'waiting':
        return t('mediaSearch.pixivLoginWaiting');
      case 'exchanging':
        return t('mediaSearch.pixivLoginExchanging');
      case 'success':
        return t('mediaSearch.pixivLoginSuccess');
      case 'error':
        return `${t('mediaSearch.pixivLoginFailed')}：${s.message ?? ''}`;
      default:
        return '';
    }
  };

  return (
    <section className="border-b border-x-border p-4">
      <h2 className="mb-1 text-xl font-extrabold">{t('mediaSearch.settingsTitle')}</h2>

      {/* 各源状态 */}
      <h3 className="mt-4 mb-2 text-[15px] font-bold text-x-dim">{t('mediaSearch.sources')}</h3>
      <div className="flex flex-wrap gap-2">
        {(sources.data?.sources ?? []).map((s) => (
          <span
            key={s.id}
            className="flex items-center gap-1.5 rounded-full border border-x-border px-3 py-1 text-[13px]"
          >
            <span className={`size-2 rounded-full ${s.ok ? 'bg-x-green' : 'bg-x-dim'}`} />
            {s.id}
            {!s.ok && (
              <span className="text-x-dim">
                （{s.reason === 'needs-login' ? t('mediaSearch.needsLogin') : t('mediaSearch.needsKey')}）
              </span>
            )}
          </span>
        ))}
      </div>

      {/* Pixiv 引导登录 */}
      <h3 className="mt-6 mb-2 text-[15px] font-bold text-x-dim">Pixiv</h3>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void startLogin()}
            disabled={login?.state === 'waiting' || login?.state === 'exchanging'}
            className="rounded-full bg-x-blue px-4 py-1.5 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
          >
            {config.data?.config.pixivLoggedIn
              ? t('mediaSearch.pixivRelogin')
              : t('mediaSearch.pixivLogin')}
          </button>
          {config.data?.config.pixivLoggedIn && (
            <span className="text-[13px] text-x-green">
              <i className="ri-checkbox-circle-fill mr-1" />
              {t('mediaSearch.pixivLoggedIn')}
            </span>
          )}
        </div>
        {login && login.state !== 'idle' && (
          <div className="text-[13px] text-x-dim">{loginStateText(login)}</div>
        )}
        {(login?.state === 'waiting' || login?.state === 'error') && (
          <div className="flex items-center gap-2">
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder={t('mediaSearch.pixivManualCode')}
              className="min-w-0 flex-1 rounded-full border border-x-border bg-transparent px-4 py-1.5 text-[13px] outline-none placeholder:text-x-dim focus:border-x-blue"
            />
            <button
              onClick={() => void submitManualCode()}
              disabled={!manualCode.trim()}
              className="rounded-full border border-x-dim px-3 py-1 text-[13px] font-bold transition-colors duration-200 hover:bg-x-input disabled:opacity-50"
            >
              {t('mediaSearch.submitCode')}
            </button>
          </div>
        )}
        {login?.loginUrl && login.state === 'error' && (
          <a
            href={login.loginUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-x-blue hover:underline"
          >
            {t('mediaSearch.openLoginUrl')}
          </a>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-x-dim">
          <input
            type="checkbox"
            checked={config.data?.config.pixivAllowR18G ?? false}
            onChange={(e) => {
              void api
                .patchMediaSearchConfig({ pixiv: { allowR18G: e.target.checked } })
                .then(refreshAll);
            }}
            className="accent-x-blue"
          />
          {t('mediaSearch.allowR18G')}
        </label>
      </div>

      {/* 代理与凭证 */}
      <h3 className="mt-6 mb-2 text-[15px] font-bold text-x-dim">{t('mediaSearch.credentials')}</h3>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-x-dim">
          {t('mediaSearch.proxy')}
          <input
            value={proxy ?? config.data?.config.proxy ?? ''}
            onChange={(e) => setProxy(e.target.value)}
            placeholder={t('mediaSearch.proxyPlaceholder')}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-x-dim">
          {t('mediaSearch.pinterestCookies')}
          {config.data?.config.pinterestHasCookies && (
            <span className="text-x-green">{t('mediaSearch.configured')}</span>
          )}
          <textarea
            value={pinterestCookies}
            onChange={(e) => setPinterestCookies(e.target.value)}
            placeholder="csrftoken=...; _pinterest_sess=..."
            rows={2}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-x-dim">
          {t('mediaSearch.pexelsKey')}
          {config.data?.config.pexelsHasKey && (
            <span className="text-x-green">{t('mediaSearch.configured')}</span>
          )}
          <input
            value={pexelsKey}
            onChange={(e) => setPexelsKey(e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="flex items-center gap-3 self-end">
          {saveMsg && <span className="text-[13px] text-x-dim">{saveMsg}</span>}
          <button
            onClick={() => void saveConfig()}
            disabled={saving}
            className="rounded-full bg-x-blue px-4 py-1.5 text-[14px] font-bold text-white transition-colors duration-200 hover:bg-x-blue-dark disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </section>
  );
}
