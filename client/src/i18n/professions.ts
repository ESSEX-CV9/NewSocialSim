import type { Locale } from './messages';

/** 专业类别（参考 X 专业账号分类的常用子集）；存储 key，展示按语言映射 */
export const PROFESSIONS: { key: string; zh: string; en: string }[] = [
  { key: 'creator', zh: '内容创作者', en: 'Content Creator' },
  { key: 'artist', zh: '艺术家', en: 'Artist' },
  { key: 'writer', zh: '作家', en: 'Writer' },
  { key: 'musician', zh: '音乐人', en: 'Musician' },
  { key: 'journalist', zh: '记者', en: 'Journalist' },
  { key: 'photographer', zh: '摄影师', en: 'Photographer' },
  { key: 'designer', zh: '设计师', en: 'Designer' },
  { key: 'developer', zh: '软件开发者', en: 'Software Developer' },
  { key: 'gamer', zh: '游戏玩家', en: 'Gamer' },
  { key: 'streamer', zh: '主播', en: 'Streamer' },
  { key: 'educator', zh: '教育工作者', en: 'Educator' },
  { key: 'scientist', zh: '科研人员', en: 'Scientist' },
  { key: 'healthcare', zh: '医疗健康', en: 'Health & Medical' },
  { key: 'finance', zh: '金融', en: 'Financial Services' },
  { key: 'legal', zh: '法律', en: 'Legal Services' },
  { key: 'government', zh: '政府机构', en: 'Government' },
  { key: 'nonprofit', zh: '非营利组织', en: 'Nonprofit' },
  { key: 'media', zh: '媒体与新闻', en: 'Media & News' },
  { key: 'entertainment', zh: '娱乐与休闲', en: 'Entertainment & Recreation' },
  { key: 'sports', zh: '体育与健身', en: 'Sports & Fitness' },
  { key: 'food', zh: '餐饮', en: 'Food & Beverage' },
  { key: 'travel', zh: '旅游', en: 'Travel & Tourism' },
  { key: 'retail', zh: '零售', en: 'Retail' },
  { key: 'tech', zh: '科技公司', en: 'Technology Company' },
];

export function professionLabel(key: string, locale: Locale): string {
  const p = PROFESSIONS.find((x) => x.key === key);
  if (!p) return key;
  return locale === 'zh-CN' ? p.zh : p.en;
}
