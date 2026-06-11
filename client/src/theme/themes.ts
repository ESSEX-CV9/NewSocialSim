import type { MessageKey } from '../i18n/messages';

/**
 * 主题注册表。新增主题的步骤：
 * 1. index.css 里加一个 [data-theme='<id>'] 变量块；
 * 2. 此处追加条目（labelKey 需在 i18n messages 里补文案）。
 */
export const THEMES = [
  { id: 'dark', labelKey: 'settings.themeDark' },
  { id: 'light', labelKey: 'settings.themeLight' },
] as const satisfies readonly { id: string; labelKey: MessageKey }[];

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'dark';
