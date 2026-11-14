export const APP_NAME = 'RubayOS';
export const API_PREFIX = '/api/v1';

export const ROLES = [
  'super_admin',
  'college_admin',
  'department_admin',
  'teacher',
  'cr',
  'student',
] as const;
export type Role = (typeof ROLES)[number];

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  nextCursor?: string | null;
}
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}
export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown; requestId?: string };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface HealthData {
  status: 'ok';
  name: string;
  version: string;
  environment: string;
  uptimeSec: number;
  time: string;
  database: { state: 'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'unknown' };
}
