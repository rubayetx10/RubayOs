/**
 * The one place that decides who may do what. Pure functions, no database, so every rule
 * can be tested with a table of cases.
 *
 * A grant is a role plus the area it covers. A resource says where something lives
 * (institution, college, department). An action is allowed when one single grant has a
 * permitted role for that action AND covers the resource.
 */
import type { Role } from '@rubayos/shared';

export type Kind = 'institution' | 'college' | 'department' | 'program' | 'session' | 'cohort' | 'semester' | 'section' | 'part';

export interface Grant {
  role: Role;
  scope: { institutionId?: string; collegeId?: string; departmentId?: string; cohortId?: string };
}

export interface Resource {
  kind: Kind;
  institutionId?: string;
  collegeId?: string;
  departmentId?: string;
}

const ADMINS: readonly Role[] = ['super_admin', 'college_admin', 'department_admin'];
const SUPER: readonly Role[] = ['super_admin'];
const SUPER_COLLEGE: readonly Role[] = ['super_admin', 'college_admin'];

export const RULES = {
  'institution:read': ADMINS,
  'institution:create': SUPER,
  'institution:update': SUPER,
  'college:read': ADMINS,
  'college:create': SUPER,
  'college:update': SUPER,
  'department:read': ADMINS,
  'department:create': SUPER_COLLEGE,
  'department:update': SUPER_COLLEGE,
  'program:read': ADMINS,
  'program:create': SUPER_COLLEGE,
  'program:update': SUPER_COLLEGE,
  // Sessions (2023-24 ...) are shared by every department of an institution.
  'session:read': ADMINS,
  'session:create': ADMINS,
  'session:update': SUPER,
  'cohort:read': ADMINS,
  'cohort:create': ADMINS,
  'cohort:update': ADMINS,
  'semester:read': ADMINS,
  'semester:create': ADMINS,
  'semester:update': ADMINS,
  'section:read': ADMINS,
  'section:create': ADMINS,
  'section:update': ADMINS,
  'part:read': ADMINS,
  'part:create': ADMINS,
  'part:update': ADMINS,
  'roster:manage': ADMINS,
  'notice:manage': ADMINS,
  'notice:college': SUPER_COLLEGE,
  'exam:read': ADMINS,
  'exam:manage': ADMINS,
  'routine:read': ADMINS,
  'routine:manage': ADMINS,
  'offering:read': ADMINS,
  'offering:manage': ADMINS,
  'course:read': ADMINS,
  'course:create': ADMINS,
  'course:update': ADMINS,
  'enrollment:read': ADMINS,
  'enrollment:manage': ADMINS,
  'registration:review': ADMINS,
  'staff:create:college_admin': SUPER,
  'staff:create:department_admin': SUPER_COLLEGE,
  'staff:create:teacher': ADMINS,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof RULES;

const INSTITUTION_LEVEL: ReadonlySet<Kind> = new Set<Kind>(['institution', 'session']);

/** Does this single grant reach the resource? Missing ids never match (undefined !== a real id). */
export function covers(grant: Grant, r: Resource): boolean {
  const s = grant.scope;
  switch (grant.role) {
    case 'super_admin':
      return true;
    case 'college_admin':
      if (INSTITUTION_LEVEL.has(r.kind)) return !!s.institutionId && s.institutionId === r.institutionId;
      return !!s.collegeId && s.collegeId === r.collegeId;
    case 'department_admin':
      if (INSTITUTION_LEVEL.has(r.kind)) return !!s.institutionId && s.institutionId === r.institutionId;
      if (r.kind === 'college') return !!s.collegeId && s.collegeId === r.collegeId;
      return !!s.departmentId && s.departmentId === r.departmentId;
    default:
      return false;
  }
}

export function can(grants: readonly Grant[], action: Action, resource: Resource): boolean {
  const allowed: readonly Role[] = RULES[action];
  return grants.some((g) => allowed.includes(g.role) && covers(g, resource));
}

// ---------------------------------------------------------------- managing other users

const RANK: Record<Role, number> = { super_admin: 5, college_admin: 4, department_admin: 3, teacher: 2, cr: 1, student: 0 };
export const rankOf = (role: Role): number => RANK[role];

/** The area a role assignment lives in, expressed as a resource. */
export function grantResource(g: Grant): Resource {
  const s = g.scope;
  if (s.departmentId) return { kind: 'department', institutionId: s.institutionId, collegeId: s.collegeId, departmentId: s.departmentId };
  if (s.collegeId) return { kind: 'college', institutionId: s.institutionId, collegeId: s.collegeId };
  return { kind: 'institution', institutionId: s.institutionId };
}

/** May the actor see this user at all? Institution-wide accounts (like Super Admin) are visible to Super Admin only. */
export function canViewUser(actor: readonly Grant[], target: readonly Grant[]): boolean {
  const isSuper = actor.some((g) => g.role === 'super_admin');
  if (isSuper) return true;
  if (target.length === 0) return false;
  return target.some((t) => {
    if (!t.scope.collegeId && !t.scope.departmentId) return false;
    return actor.some((a) => ADMINS.includes(a.role) && covers(a, grantResource(t)) && (a.role !== 'department_admin' || !!t.scope.departmentId));
  });
}

/**
 * May the actor deactivate, reactivate or change roles of this user?
 * Every role the target holds must be strictly below one of the actor's roles AND inside that role's area.
 * So nobody can touch an equal or higher account, and nobody can touch a Super Admin.
 */
export function canManageUser(actor: readonly Grant[], target: readonly Grant[]): boolean {
  if (target.length === 0) return actor.some((g) => g.role === 'super_admin');
  return target.every((t) => actor.some((a) => ADMINS.includes(a.role) && RANK[a.role] > RANK[t.role] && covers(a, grantResource(t))));
}
