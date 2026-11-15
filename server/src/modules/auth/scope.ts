import { AppError } from '../../common/errors';
import type { AuthContext } from '../../middleware/authenticate';
import { Cohort, College, Department } from '../academic/academic.models';
import { can, type Action, type Resource } from './policy';

export function assertCan(auth: AuthContext, action: Action, resource: Resource): void {
  if (!can(auth.roles, action, resource)) throw AppError.forbidden('This is outside your area');
}

export async function departmentResource(departmentId: unknown): Promise<Resource> {
  const d = await Department.findById(String(departmentId)).lean();
  if (!d) throw AppError.notFound('Department not found');
  return { kind: 'department', institutionId: String(d.institutionId), collegeId: String(d.collegeId), departmentId: String(d._id) };
}

export async function assertDepartmentAccess(auth: AuthContext, departmentId: unknown, action: Action): Promise<void> {
  assertCan(auth, action, await departmentResource(departmentId));
}

export async function assertCohortAccess(auth: AuthContext, cohortId: unknown, action: Action) {
  const cohort = await Cohort.findById(String(cohortId));
  if (!cohort) throw AppError.notFound('Cohort not found');
  assertCan(auth, action, {
    kind: 'cohort',
    institutionId: String(cohort.institutionId),
    collegeId: String(cohort.collegeId),
    departmentId: String(cohort.departmentId),
  });
  return cohort;
}

/** Resource for a staff role being created or granted: a college for college admins, a department otherwise. */
export async function staffRoleResource(role: 'college_admin' | 'department_admin' | 'teacher', collegeId?: string, departmentId?: string) {
  if (role === 'college_admin') {
    if (!collegeId) throw AppError.badRequest('collegeId is required for a college admin');
    const c = await College.findById(collegeId).lean();
    if (!c) throw AppError.badRequest('College not found');
    const scope = { institutionId: c.institutionId, collegeId: c._id };
    const resource: Resource = { kind: 'college', institutionId: String(c.institutionId), collegeId: String(c._id) };
    return { resource, scope };
  }
  if (!departmentId) throw AppError.badRequest('departmentId is required');
  const d = await Department.findById(departmentId).lean();
  if (!d) throw AppError.badRequest('Department not found');
  const scope = { institutionId: d.institutionId, collegeId: d.collegeId, departmentId: d._id };
  const resource: Resource = { kind: 'department', institutionId: String(d.institutionId), collegeId: String(d.collegeId), departmentId: String(d._id) };
  return { resource, scope };
}

/** Mongo filter limiting records that carry collegeId / departmentId to the admin's own area. */
export function areaFilter(auth: AuthContext): Record<string, unknown> {
  if (auth.roles.some((g) => g.role === 'super_admin')) return {};
  const colleges = auth.roles.filter((g) => g.role === 'college_admin' && g.scope.collegeId).map((g) => g.scope.collegeId);
  const depts = auth.roles.filter((g) => g.role === 'department_admin' && g.scope.departmentId).map((g) => g.scope.departmentId);
  return { $or: [{ collegeId: { $in: colleges } }, { departmentId: { $in: depts } }] };
}
