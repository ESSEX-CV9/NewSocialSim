import type { UserProfile } from './user.js';

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
}
