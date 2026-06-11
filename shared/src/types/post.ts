/** 帖子实体（贫血模型：纯数据，无行为） */
export interface Post {
  id: number;
  authorId: number;
  content: string;
  /** 若为回复，指向被回复的帖子 */
  replyToId: number | null;
  /** 若为引用转发，指向被引用的帖子 */
  quoteOfId: number | null;
  /** 模拟时间（unix 毫秒形式） */
  createdAt: number;
  likeCount: number;
  repostCount: number;
  /** 被引用次数（前端与转发数合并显示） */
  quoteCount: number;
  replyCount: number;
  /** 软删除：保留占位以维持对话串完整（"此帖已删除"） */
  deleted: boolean;
}
