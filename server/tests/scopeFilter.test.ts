import { describe, expect, it } from 'vitest';
import { directScopeFilter } from '../src/modules/academic/academic.access';
import type { Grant } from '../src/modules/auth/policy';

const superAdmin: Grant = { role: 'super_admin', scope: {} };
const collegeAdmin: Grant = { role: 'college_admin', scope: { institutionId: 'I', collegeId: 'CA' } };
const deptAdmin: Grant = { role: 'department_admin', scope: { institutionId: 'I', collegeId: 'CA', departmentId: 'DA1' } };

describe('directScopeFilter', () => {
  it('super admin sees everything (empty filter)', () => {
    for (const k of ['institution', 'college', 'department', 'program', 'session', 'cohort'] as const) {
      expect(directScopeFilter(k, [superAdmin])).toEqual({});
    }
  });
  it('department admin sees only own department data', () => {
    expect(directScopeFilter('cohort', [deptAdmin])).toEqual({ $or: [{ collegeId: { $in: [] } }, { departmentId: { $in: ['DA1'] } }] });
    expect(directScopeFilter('department', [deptAdmin])).toEqual({ $or: [{ collegeId: { $in: [] } }, { _id: { $in: ['DA1'] } }] });
    expect(directScopeFilter('college', [deptAdmin])).toEqual({ _id: { $in: ['CA'] } });
  });
  it('college admin sees own college data', () => {
    expect(directScopeFilter('cohort', [collegeAdmin])).toEqual({ $or: [{ collegeId: { $in: ['CA'] } }, { departmentId: { $in: [] } }] });
    expect(directScopeFilter('program', [collegeAdmin])).toEqual({ $or: [{ collegeId: { $in: ['CA'] } }, { departmentId: { $in: [] } }] });
  });
  it('shared sessions are limited to the admin institution', () => {
    expect(directScopeFilter('session', [deptAdmin])).toEqual({ institutionId: { $in: ['I'] } });
  });
  it('a teacher or student gets a filter that matches nothing', () => {
    const teacher: Grant = { role: 'teacher', scope: { institutionId: 'I', collegeId: 'CA', departmentId: 'DA1' } };
    expect(directScopeFilter('cohort', [teacher])).toEqual({ $or: [{ collegeId: { $in: [] } }, { departmentId: { $in: [] } }] });
    expect(directScopeFilter('session', [teacher])).toEqual({ institutionId: { $in: [] } });
  });
  it('no grants at all matches nothing', () => {
    expect(directScopeFilter('institution', [])).toEqual({ _id: { $in: [] } });
  });
  it('de-duplicates ids when an admin holds several grants', () => {
    const f = directScopeFilter('college', [deptAdmin, { ...deptAdmin, scope: { ...deptAdmin.scope, departmentId: 'DA2' } }]);
    expect(f).toEqual({ _id: { $in: ['CA'] } });
  });
});
