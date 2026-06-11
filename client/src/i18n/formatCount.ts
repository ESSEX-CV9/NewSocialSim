import { useCallback } from 'react';
import { useI18n } from './I18nContext';
import type { Locale } from './messages';

/** 截断到 0.1 个 divisor 单位（整数运算避免浮点误差），无意义的 .0 省略 */
function withUnit(n: number, divisor: number, unit: string): string {
  const tenths = Math.floor(n / (divisor / 10));
  return tenths % 10 === 0
    ? `${tenths / 10}${unit}`
    : `${Math.floor(tenths / 10)}.${tenths % 10}${unit}`;
}

/** X 式计数缩写：zh ≥1万 → x.x万 / ≥1亿 → x.x亿；en ≥1K → x.xK / x.xM / x.xB（截断不四舍五入） */
export function formatCount(n: number, locale: Locale): string {
  if (locale === 'zh-CN') {
    if (n < 10_000) return String(n);
    if (n < 100_000_000) return withUnit(n, 10_000, '万');
    return withUnit(n, 100_000_000, '亿');
  }
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return withUnit(n, 1_000, 'K');
  if (n < 1_000_000_000) return withUnit(n, 1_000_000, 'M');
  return withUnit(n, 1_000_000_000, 'B');
}

export function useFormatCount(): (n: number) => string {
  const { locale } = useI18n();
  return useCallback((n: number) => formatCount(n, locale), [locale]);
}
