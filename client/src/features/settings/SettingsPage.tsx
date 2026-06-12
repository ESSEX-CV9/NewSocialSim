import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import type { Locale } from '../../i18n/messages';
import { THEMES, type ThemeId } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeContext';
import { MediaSearchSettings } from './MediaSearchSettings';
import { VideoToolsSettings } from './VideoToolsSettings';

const LOCALES: { id: Locale; label: string }[] = [
  { id: 'zh-CN', label: '中文' },
  { id: 'en', label: 'English' },
];

function OptionCard({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-4 text-[15px] font-bold transition-colors duration-200 ${
        selected ? 'border-x-blue' : 'border-x-border hover:bg-x-hover'
      }`}
    >
      {selected && <i className="ri-checkbox-circle-fill text-x-blue" />}
      {label}
    </button>
  );
}

export function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div>
      <div className="glass-header flex items-center gap-5 px-3 py-2">
        <button
          onClick={() => navigate(-1)}
          className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
        >
          <i className="ri-arrow-left-line text-[16px]" />
        </button>
        <span className="text-[17px] font-bold">{t('settings.title')}</span>
      </div>

      <section className="border-b border-x-border p-4">
        <h2 className="mb-1 text-xl font-extrabold">{t('settings.display')}</h2>
        <h3 className="mt-4 mb-2 text-[15px] font-bold text-x-dim">{t('settings.theme')}</h3>
        <div className="flex gap-3">
          {THEMES.map((th) => (
            <OptionCard
              key={th.id}
              selected={theme === th.id}
              label={t(th.labelKey)}
              onClick={() => setTheme(th.id as ThemeId)}
            />
          ))}
        </div>

        <h3 className="mt-6 mb-2 text-[15px] font-bold text-x-dim">{t('settings.language')}</h3>
        <div className="flex gap-3">
          {LOCALES.map((l) => (
            <OptionCard
              key={l.id}
              selected={locale === l.id}
              label={l.label}
              onClick={() => setLocale(l.id)}
            />
          ))}
        </div>
      </section>

      {/* 媒体搜索配置（需登录：接口走 requireAuth） */}
      {user && <MediaSearchSettings />}

      {/* 视频工具（yt-dlp/ffmpeg 一键安装，视频搜索与引入的前置依赖） */}
      {user && <VideoToolsSettings />}
    </div>
  );
}
