import type { UserProfile, VerifiedType } from './user.js';

export interface RegisterRequest {
  handle: string;
  displayName: string;
  password: string;
}

export interface LoginRequest {
  handle: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface UpdateProfileRequest {
  displayName?: string;
  bio?: string;
  /** 须为本人所有的图片媒体；null = 恢复默认（哈希色块/纯色） */
  avatarMediaId?: number | null;
  bannerMediaId?: number | null;
  /** 认证标识（模拟器内自助设定） */
  verified?: VerifiedType;
  /** 个人链接；空串或 null = 清除。无协议前缀时服务端补 https:// */
  website?: string | null;
}

export interface CreatePostRequest {
  content: string;
  replyToId?: number;
  quoteOfId?: number;
  /** 附加媒体 id（≤4，须本人所有且未挂过其他帖）；有媒体时 content 可为空 */
  mediaIds?: number[];
}
