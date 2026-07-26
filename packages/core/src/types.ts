export type UserRole = 'owner' | 'listener';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  canDownload: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
  deviceName?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  expiresAt: string;
}

export interface RedeemInviteRequest {
  token: string;
  username: string;
  password: string;
  deviceName?: string;
}

export interface CreateInviteResponse {
  token: string;
  role: UserRole;
  expiresAt: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
}
