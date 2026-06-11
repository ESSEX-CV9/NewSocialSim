import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { useWorld } from '../world/WorldContext';

/** 跳动的模拟时间钟（含世界历法名） */
export function SimClockDisplay() {
  const { world, simNow } = useWorld();
  const { t, locale } = useI18n();
  const [now, setNow] = useState(simNow());

  useEffect(() => {
    const timer = setInterval(() => setNow(simNow()), 1000);
    return () => clearInterval(timer);
  }, [simNow]);

  if (!world) return null;
  return (
    <div>
      {t('worlds.simTime')}（{world.meta.calendar.label}）:{' '}
      <span className="font-mono text-gray-200">{new Date(now).toLocaleString(locale)}</span>
    </div>
  );
}
