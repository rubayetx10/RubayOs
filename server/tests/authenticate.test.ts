import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

// The database is replaced by fakes so we can test the decisions authenticate() makes.
const state = vi.hoisted(() => ({
  user: null as null | { status: string; rolesVersion: number },
  family: true,
  grants: [] as Array<{ role: string; scope: Record<string, unknown> }>,
}));

vi.mock('../src/modules/auth/auth.models', () => ({
  User: { findById: () => ({ select: () => ({ lean: async () => state.user }) }) },
  RefreshSession: { exists: async () => (state.family ? { _id: 'x' } : null) },
  RoleAssignment: { find: () => ({ lean: async () => state.grants }) },
}));

import { authenticate, requireRole } from '../src/middleware/authenticate';
import { signAccessToken } from '../src/modules/auth/tokens';

const token = (rolesVersion = 0) => signAccessToken({ userId: 'u1', familyId: 'f1', rolesVersion });
const reqWith = (header?: string) => ({ headers: header ? { authorization: header } : {} }) as unknown as Request;

async function run(req: Request) {
  const next = vi.fn();
  await authenticate(req, {} as Response, next);
  return { next, err: next.mock.calls[0]?.[0] as { statusCode?: number } | undefined };
}

beforeEach(() => {
  state.user = { status: 'active', rolesVersion: 0 };
  state.family = true;
  state.grants = [{ role: 'department_admin', scope: { collegeId: 'c1', departmentId: 'd1' } }];
});

describe('authenticate', () => {
  it('accepts a valid token and loads roles from the database', async () => {
    const req = reqWith(`Bearer ${token()}`);
    const { err } = await run(req);
    expect(err).toBeUndefined();
    expect(req.auth?.userId).toBe('u1');
    expect(req.auth?.roles).toEqual([{ role: 'department_admin', scope: { institutionId: undefined, collegeId: 'c1', departmentId: 'd1', cohortId: undefined } }]);
  });
  it('rejects a missing header', async () => expect((await run(reqWith())).err?.statusCode).toBe(401));
  it('rejects a deactivated user even with a valid token', async () => {
    state.user = { status: 'deactivated', rolesVersion: 0 };
    expect((await run(reqWith(`Bearer ${token()}`))).err?.statusCode).toBe(401);
  });
  it('rejects a user that no longer exists', async () => {
    state.user = null;
    expect((await run(reqWith(`Bearer ${token()}`))).err?.statusCode).toBe(401);
  });
  it('rejects a token issued before a role change (rolesVersion mismatch)', async () => {
    state.user = { status: 'active', rolesVersion: 1 };
    expect((await run(reqWith(`Bearer ${token(0)}`))).err?.statusCode).toBe(401);
  });
  it('rejects once the login (session family) was revoked, e.g. after logout', async () => {
    state.family = false;
    expect((await run(reqWith(`Bearer ${token()}`))).err?.statusCode).toBe(401);
  });
  it('rejects pending and invited accounts', async () => {
    for (const status of ['pending_approval', 'invited', 'rejected']) {
      state.user = { status, rolesVersion: 0 };
      expect((await run(reqWith(`Bearer ${token()}`))).err?.statusCode).toBe(401);
    }
  });
});

describe('requireRole', () => {
  const call = (roles: string[], allowed: Parameters<typeof requireRole>) => {
    const req = { auth: { userId: 'u', familyId: 'f', roles: roles.map((role) => ({ role, scope: {} })) } } as unknown as Request;
    const next = vi.fn();
    requireRole(...allowed)(req, {} as Response, next);
    return next.mock.calls[0]?.[0] as { statusCode?: number } | undefined;
  };
  it('lets an allowed role through', () => expect(call(['department_admin'], ['department_admin', 'super_admin'])).toBeUndefined());
  it('blocks a teacher from admin routes with 403', () => expect(call(['teacher'], ['super_admin', 'college_admin', 'department_admin'])?.statusCode).toBe(403));
  it('blocks a student with 403', () => expect(call(['student'], ['super_admin'])?.statusCode).toBe(403));
  it('returns 401 when nobody is logged in', () => {
    const next = vi.fn();
    requireRole('super_admin')({} as Request, {} as Response, next);
    expect((next.mock.calls[0]?.[0] as { statusCode?: number }).statusCode).toBe(401);
  });
});
