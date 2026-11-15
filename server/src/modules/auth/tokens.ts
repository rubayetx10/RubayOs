import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { AppError } from '../../common/errors';
import { env, isProd } from '../../config/env';

export const REFRESH_COOKIE = 'rubayos_rt';
const COOKIE_PATH = '/api/v1/auth';

export interface AccessClaims {
  userId: string;
  familyId: string;
  rolesVersion: number;
}

function secret(): string {
  if (!env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET is not set');
  return env.JWT_ACCESS_SECRET;
}

export function signAccessToken(c: AccessClaims): string {
  return jwt.sign({ fid: c.familyId, rv: c.rolesVersion }, secret(), {
    algorithm: 'HS256',
    subject: c.userId,
    expiresIn: `${env.ACCESS_TTL_MIN}m`,
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const p = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    if (typeof p === 'string' || !p.sub || typeof p['fid'] !== 'string' || typeof p['rv'] !== 'number') {
      throw new Error('bad claims');
    }
    return { userId: p.sub, familyId: p['fid'], rolesVersion: p['rv'] };
  } catch {
    throw AppError.unauthorized('Session expired or invalid');
  }
}

export function refreshCookieOptions(expires: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: COOKIE_PATH,
    expires,
  };
}

export function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(expires));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: isProd, sameSite: 'lax', path: COOKIE_PATH });
}
