import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@rubayos/shared';
import { AppError } from '../common/errors';
import { verifyAccessToken } from '../modules/auth/tokens';
import { RefreshSession, RoleAssignment, User } from '../modules/auth/auth.models';

export interface RoleGrant {
  role: Role;
  scope: { institutionId?: string; collegeId?: string; departmentId?: string; cohortId?: string };
}
export interface AuthContext {
  userId: string;
  familyId: string;
  roles: RoleGrant[];
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

const str = (v: unknown): string | undefined => (v ? String(v) : undefined);

/**
 * Verifies the access token AND checks the database: the session family must still be alive,
 * the account must be active and the roles version must match. Logout and role changes therefore
 * take effect immediately instead of after the token expires.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
    const claims = verifyAccessToken(header.slice(7));

    const [user, family, grants] = await Promise.all([
      User.findById(claims.userId).select('status rolesVersion').lean(),
      RefreshSession.exists({ familyId: claims.familyId, userId: claims.userId, revokedAt: null, expiresAt: { $gt: new Date() } }),
      RoleAssignment.find({ userId: claims.userId, status: 'active' }).lean(),
    ]);
    if (!user || user.status !== 'active' || user.rolesVersion !== claims.rolesVersion || !family) {
      throw AppError.unauthorized('Session expired or invalid');
    }

    req.auth = {
      userId: claims.userId,
      familyId: claims.familyId,
      roles: grants.map((g) => ({
        role: g.role as Role,
        scope: {
          institutionId: str(g.scope?.institutionId),
          collegeId: str(g.scope?.collegeId),
          departmentId: str(g.scope?.departmentId),
          cohortId: str(g.scope?.cohortId),
        },
      })),
    };
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole =
  (...allowed: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(AppError.unauthorized());
    if (!req.auth.roles.some((g) => allowed.includes(g.role))) return next(AppError.forbidden());
    next();
  };
