/* eslint-disable @typescript-eslint/no-explicit-any */
import { AppError } from '../../common/errors';
import type { Grant, Kind, Resource } from '../auth/policy';
import { Cohort } from './academic.models';

const s = (v: unknown): string | undefined => (v ? String(v) : undefined);

/**
 * Where does this record (or this about-to-be-created payload) live?
 * Ids come from the database-derived fields, never from what the client typed.
 */
export async function resourceOf(kind: Kind, doc: any): Promise<Resource> {
  switch (kind) {
    case 'institution':
      return { kind, institutionId: s(doc._id) };
    case 'college':
      return { kind, institutionId: s(doc.institutionId), collegeId: s(doc._id) };
    case 'department':
      return { kind, institutionId: s(doc.institutionId), collegeId: s(doc.collegeId), departmentId: s(doc._id) };
    case 'session':
      return { kind, institutionId: s(doc.institutionId) };
    case 'program':
    case 'cohort':
      return { kind, institutionId: s(doc.institutionId), collegeId: s(doc.collegeId), departmentId: s(doc.departmentId) };
    default: {
      // semester, section, part: they only know their cohort, so ask the cohort where it lives.
      const cohort = await Cohort.findById(doc.cohortId).lean();
      if (!cohort) throw AppError.badRequest('Cohort not found');
      return { kind, institutionId: s(cohort.institutionId), collegeId: s(cohort.collegeId), departmentId: s(cohort.departmentId) };
    }
  }
}

const ids = (grants: readonly Grant[], role: Grant['role'], key: keyof Grant['scope']): string[] =>
  grants.filter((g) => g.role === role && g.scope[key]).map((g) => g.scope[key] as string);

/**
 * Mongo filter of what the grants may see for kinds that store their own ids.
 * `{}` means everything (Super Admin). A filter that matches nothing is returned when no grant applies.
 */
export function directScopeFilter(kind: Exclude<Kind, 'semester' | 'section' | 'part'>, grants: readonly Grant[]): Record<string, unknown> {
  if (grants.some((g) => g.role === 'super_admin')) return {};
  const institutions = [...new Set([...ids(grants, 'college_admin', 'institutionId'), ...ids(grants, 'department_admin', 'institutionId')])];
  const collegesOwned = ids(grants, 'college_admin', 'collegeId');
  const collegesSeen = [...new Set([...collegesOwned, ...ids(grants, 'department_admin', 'collegeId')])];
  const departments = ids(grants, 'department_admin', 'departmentId');

  switch (kind) {
    case 'institution':
      return { _id: { $in: institutions } };
    case 'session':
      return { institutionId: { $in: institutions } };
    case 'college':
      return { _id: { $in: collegesSeen } };
    case 'department':
      return { $or: [{ collegeId: { $in: collegesOwned } }, { _id: { $in: departments } }] };
    case 'program':
    case 'cohort':
      return { $or: [{ collegeId: { $in: collegesOwned } }, { departmentId: { $in: departments } }] };
  }
}

export async function visibleFilter(kind: Kind, grants: readonly Grant[]): Promise<Record<string, unknown>> {
  if (kind === 'semester' || kind === 'section' || kind === 'part') {
    if (grants.some((g) => g.role === 'super_admin')) return {};
    const cohortIds = await Cohort.find(directScopeFilter('cohort', grants)).distinct('_id');
    return { cohortId: { $in: cohortIds } };
  }
  return directScopeFilter(kind, grants);
}
