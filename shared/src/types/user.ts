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
}
