import type { UserSummary } from './views.js';

/** 认证类型：none=无 / personal=个人（蓝标）/ org=组织（金标） */
export type VerifiedType = 'none' | 'personal' | 'org';

/** 用户实体（贫血模型：纯数据，无行为） */
export interface User {
  id: number;
  /** @handle，全站唯一，不含 @ 前缀 */
  handle: string;
  displayName: string;
  bio: string;
  /** 是否为模拟器驱动的虚拟用户（第二阶段使用） */
  isBot: boolean;
  /** 模拟时间（unix 毫秒形式） */
  createdAt: number;
}

/** 对外公开的用户信息（带统计数字与观察者状态） */
export interface UserProfile extends User {
  followerCount: number;
  followingCount: number;
  postCount: number;
  /** 当前观察者是否已关注此人（匿名时为 false） */
  followedByViewer: boolean;
  /** 当前观察者是否已屏蔽此人（匿名时为 false） */
  blockedByViewer: boolean;
  /** 本人的置顶帖 id（每用户最多一条） */
  pinnedPostId: number | null;
  /** 头像图片地址；null = 用 handle 哈希色块兜底 */
  avatarUrl: string | null;
  /** 主页横幅图片地址；null = 纯色占位 */
  bannerUrl: string | null;
  avatarMediaId: number | null;
  bannerMediaId: number | null;
  /** 认证标识（模拟器内自助设定） */
  verified: VerifiedType;
  /** 简介下方展示的个人链接；null = 未设置 */
  website: string | null;
  /** 观察者关注的人里也关注此人的（最多 3 个，匿名或本人页为空数组） */
  knownFollowers: UserSummary[];
  knownFollowerCount: number;
}
