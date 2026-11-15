import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { authenticate, requireRole, type RoleGrant } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { objectId } from '../academic/academic.schemas';
import { audit } from '../audit/audit.model';
import { RoleAssignment, User } from '../auth/auth.models';
import { revokeAllSessions } from '../auth/auth.service';
import { canManageUser, canViewUser, type Grant } from '../auth/policy';
import { assertCan, staffRoleResource } from '../auth/scope';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'college_admin', 'department_admin'));

const idParams = z.object({ id: objectId });
const str = (v: unknown) => (v ? String(v) : undefined);

type Assignment = { _id: unknown; role: string; scope?: Record<string, unknown> | null };
const toGrant = (a: Assignment): RoleGrant => ({
  role: a.role as RoleGrant['role'],
  scope: {
    institutionId: str(a.scope?.['institutionId']),
    collegeId: str(a.scope?.['collegeId']),
    departmentId: str(a.scope?.['departmentId']),
    cohortId: str(a.scope?.['cohortId']),
  },
});

async function loadTarget(id: string, actor: Grant[]) {
  const user = await User.findById(id).select('-passwordHash');
  const assignments = await RoleAssignment.find({ userId: id, status: 'active' }).lean();
  const grants = assignments.map(toGrant);
  // Out-of-area users answer 404 so their existence is not revealed.
  if (!user || !canViewUser(actor, grants)) throw AppError.notFound('User not found');
  return { user, assignments, grants };
}

const present = (user: { _id: unknown; name: string; email: string; registrationNo?: string | null; status: string; lastLoginAt?: Date | null }, assignments: Assignment[]) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  registrationNo: user.registrationNo ?? null,
  status: user.status,
  lastLoginAt: user.lastLoginAt ?? null,
  roles: assignments.map((a) => ({ assignmentId: String(a._id), role: a.role, scope: a.scope })),
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const listQuery = z.object({
  q: z.string().trim().max(60).optional(),
  status: z.enum(['active', 'pending_approval', 'invited', 'rejected', 'deactivated']).optional(),
  role: z.enum(['college_admin', 'department_admin', 'teacher', 'student']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.validated!.query as z.infer<typeof listQuery>;
    const actor = req.auth!.roles;
    const isSuper = actor.some((g) => g.role === 'super_admin');

    const grantFilter: Record<string, unknown> = { status: 'active', ...(q.role ? { role: q.role } : {}) };
    if (!isSuper) {
      const colleges = actor.filter((g) => g.role === 'college_admin' && g.scope.collegeId).map((g) => g.scope.collegeId);
      const depts = actor.filter((g) => g.role === 'department_admin' && g.scope.departmentId).map((g) => g.scope.departmentId);
      grantFilter['$or'] = [{ 'scope.collegeId': { $in: colleges } }, { 'scope.departmentId': { $in: depts } }];
    }

    const filter: Record<string, unknown> = {};
    if (!isSuper || q.role) filter['_id'] = { $in: await RoleAssignment.find(grantFilter).distinct('userId') };
    if (q.status) filter['status'] = q.status;
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter['$or'] = [{ name: rx }, { email: rx }, { registrationNo: rx }];
    }

    const [users, total] = await Promise.all([
      User.find(filter).select('-passwordHash').sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      User.countDocuments(filter),
    ]);
    const grants = await RoleAssignment.find({ userId: { $in: users.map((u) => u._id) }, status: 'active' }).lean();
    sendSuccess(
      res,
      users.map((u) =>
        present(u, grants.filter((g) => String(g.userId) === String(u._id))),
      ),
      { page: q.page, limit: q.limit, total },
    );
  }),
);

router.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { user, assignments } = await loadTarget((req.validated!.params as { id: string }).id, req.auth!.roles);
    sendSuccess(res, present(user, assignments));
  }),
);

/** Role changes and deactivation take effect at once: rolesVersion changes, so old access tokens stop working. */
async function bump(userId: unknown) {
  await User.updateOne({ _id: userId }, { $inc: { rolesVersion: 1 } });
}

router.post(
  '/:id/deactivate',
  validate({ params: idParams, body: z.object({ reason: z.string().trim().min(3).max(300) }).strict() }),
  asyncHandler(async (req, res) => {
    const id = (req.validated!.params as { id: string }).id;
    if (id === req.auth!.userId) throw AppError.badRequest('You cannot deactivate your own account');
    const { user, grants } = await loadTarget(id, req.auth!.roles);
    if (!canManageUser(req.auth!.roles, grants)) throw AppError.forbidden('You cannot manage this account');
    if (user.status === 'deactivated') throw AppError.conflict('This account is already deactivated');

    user.status = 'deactivated';
    await user.save();
    await bump(user._id);
    await revokeAllSessions(user._id, 'admin');
    await audit({ actorId: req.auth!.userId, action: 'user.deactivate', entityType: 'User', entityId: user._id, meta: { reason: (req.validated!.body as { reason: string }).reason }, req });
    sendSuccess(res, { id, status: 'deactivated' });
  }),
);

router.post(
  '/:id/reactivate',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const id = (req.validated!.params as { id: string }).id;
    const { user, grants } = await loadTarget(id, req.auth!.roles);
    if (!canManageUser(req.auth!.roles, grants)) throw AppError.forbidden('You cannot manage this account');
    if (user.status !== 'deactivated') throw AppError.conflict('Only a deactivated account can be reactivated');

    user.status = 'active';
    user.failedLogins = 0;
    user.lockedUntil = null;
    await user.save();
    await bump(user._id);
    await audit({ actorId: req.auth!.userId, action: 'user.reactivate', entityType: 'User', entityId: user._id, req });
    sendSuccess(res, { id, status: 'active' });
  }),
);

const roleSchema = z
  .object({
    role: z.enum(['college_admin', 'department_admin', 'teacher']),
    collegeId: objectId.optional(),
    departmentId: objectId.optional(),
  })
  .strict();

router.post(
  '/:id/roles',
  validate({ params: idParams, body: roleSchema }),
  asyncHandler(async (req, res) => {
    const id = (req.validated!.params as { id: string }).id;
    const body = req.validated!.body as z.infer<typeof roleSchema>;
    const { user, grants } = await loadTarget(id, req.auth!.roles);
    if (id === req.auth!.userId) throw AppError.badRequest('You cannot change your own roles');
    if (!canManageUser(req.auth!.roles, grants)) throw AppError.forbidden('You cannot manage this account');
    if (user.status !== 'active') throw AppError.conflict('Roles can only be added to an active account');

    const { resource, scope } = await staffRoleResource(body.role, body.collegeId, body.departmentId);
    assertCan(req.auth!, `staff:create:${body.role}`, resource);

    const dup = await RoleAssignment.exists({
      userId: user._id,
      role: body.role,
      status: 'active',
      'scope.collegeId': scope.collegeId,
      'scope.departmentId': 'departmentId' in scope ? scope.departmentId : null,
    });
    if (dup) throw AppError.conflict('This person already has that role there');

    const created = await RoleAssignment.create({ userId: user._id, role: body.role, scope, grantedBy: req.auth!.userId });
    await bump(user._id);
    await audit({ actorId: req.auth!.userId, action: 'user.role.add', entityType: 'User', entityId: user._id, meta: { role: body.role, assignmentId: String(created._id) }, req });
    sendSuccess(res, { assignmentId: String(created._id), role: body.role }, undefined, 201);
  }),
);

router.delete(
  '/:id/roles/:assignmentId',
  validate({ params: z.object({ id: objectId, assignmentId: objectId }) }),
  asyncHandler(async (req, res) => {
    const { id, assignmentId } = req.validated!.params as { id: string; assignmentId: string };
    if (id === req.auth!.userId) throw AppError.badRequest('You cannot change your own roles');
    const { user, assignments, grants } = await loadTarget(id, req.auth!.roles);
    const target = assignments.find((a) => String(a._id) === assignmentId);
    if (!target) throw AppError.notFound('Role not found');
    if (!['college_admin', 'department_admin', 'teacher'].includes(target.role)) {
      throw AppError.badRequest('Only staff roles can be removed here');
    }
    if (!canManageUser(req.auth!.roles, grants)) throw AppError.forbidden('You cannot manage this account');

    await RoleAssignment.updateOne({ _id: assignmentId }, { $set: { status: 'revoked' } });
    await bump(user._id);
    await audit({ actorId: req.auth!.userId, action: 'user.role.remove', entityType: 'User', entityId: user._id, meta: { role: target.role, assignmentId }, req });
    sendSuccess(res, { removed: true });
  }),
);

export default router;
