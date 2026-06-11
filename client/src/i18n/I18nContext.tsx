import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { messages, type Locale, type MessageKey } from './messages';

const LOCALE_KEY = 'socialsim.locale';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  defaultLocale,
  children,
}: {
  defaultLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem(LOCALE_KEY);
    return saved === 'zh-CN' || saved === 'en' ? saved : defaultLocale;
  });

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(LOCALE_KEY, next);
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>): string => {
      let text: string = messages[locale][key] ?? messages['zh-CN'][key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
