import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { useWorld } from '../world/WorldContext';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** 相对"世界模拟时间"的时间标签；超过 7 天显示该世界的绝对日期 */
export function TimeAgo({ at }: { at: number }) {
  const { simNow } = useWorld();
  const { t, locale } = useI18n();
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const diff = simNow() - at;
  let text: string;
  if (diff < MINUTE) text = t('time.now');
  else if (diff < HOUR) text = t('time.minutes', { n: Math.floor(diff / MINUTE) });
  else if (diff < DAY) text = t('time.hours', { n: Math.floor(diff / HOUR) });
  else if (diff < 7 * DAY) text = t('time.days', { n: Math.floor(diff / DAY) });
  else text = new Date(at).toLocaleDateString(locale);

  return (
    <time className="text-gray-500" title={new Date(at).toLocaleString(locale)}>
      {text}
    </time>
  );
}
