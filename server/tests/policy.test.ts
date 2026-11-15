import { describe, expect, it } from 'vitest';
import { can, canManageUser, canViewUser, covers, type Action, type Grant, type Resource } from '../src/modules/auth/policy';

// One institution (I), two colleges (A, B). College A has two departments (A1, A2); college B has one (B1).
const I = 'inst1', CA = 'colA', CB = 'colB', DA1 = 'deptA1', DA2 = 'deptA2', DB1 = 'deptB1';

const superAdmin: Grant = { role: 'super_admin', scope: { institutionId: I } };
const collegeAdminA: Grant = { role: 'college_admin', scope: { institutionId: I, collegeId: CA } };
const collegeAdminB: Grant = { role: 'college_admin', scope: { institutionId: I, collegeId: CB } };
const deptAdminA1: Grant = { role: 'department_admin', scope: { institutionId: I, collegeId: CA, departmentId: DA1 } };
const deptAdminB1: Grant = { role: 'department_admin', scope: { institutionId: I, collegeId: CB, departmentId: DB1 } };
const teacherA1: Grant = { role: 'teacher', scope: { institutionId: I, collegeId: CA, departmentId: DA1 } };
const studentA1: Grant = { role: 'student', scope: { institutionId: I, collegeId: CA, departmentId: DA1, cohortId: 'c1' } };

const res = {
  institution: { kind: 'institution', institutionId: I } as Resource,
  collegeA: { kind: 'college', institutionId: I, collegeId: CA } as Resource,
  collegeB: { kind: 'college', institutionId: I, collegeId: CB } as Resource,
  deptA1: { kind: 'department', institutionId: I, collegeId: CA, departmentId: DA1 } as Resource,
  deptA2: { kind: 'department', institutionId: I, collegeId: CA, departmentId: DA2 } as Resource,
  deptB1: { kind: 'department', institutionId: I, collegeId: CB, departmentId: DB1 } as Resource,
  cohortA1: { kind: 'cohort', institutionId: I, collegeId: CA, departmentId: DA1 } as Resource,
  cohortA2: { kind: 'cohort', institutionId: I, collegeId: CA, departmentId: DA2 } as Resource,
  cohortB1: { kind: 'cohort', institutionId: I, collegeId: CB, departmentId: DB1 } as Resource,
  session: { kind: 'session', institutionId: I } as Resource,
  otherInstSession: { kind: 'session', institutionId: 'inst2' } as Resource,
};

type Row = [string, Grant, Action, keyof typeof res, boolean];

const table: Row[] = [
  // Super admin can do everything
  ['super: create college', superAdmin, 'college:create', 'collegeA', true],
  ['super: update department', superAdmin, 'department:update', 'deptB1', true],
  ['super: manage roster anywhere', superAdmin, 'roster:manage', 'cohortB1', true],

  // College admin: own college only
  ['collegeA: read own college', collegeAdminA, 'college:read', 'collegeA', true],
  ['collegeA: cannot read college B', collegeAdminA, 'college:read', 'collegeB', false],
  ['collegeA: cannot update own college record', collegeAdminA, 'college:update', 'collegeA', false],
  ['collegeA: create department in own college', collegeAdminA, 'department:create', 'deptA1', true],
  ['collegeA: cannot create department in college B', collegeAdminA, 'department:create', 'deptB1', false],
  ['collegeA: manage cohort in dept A2', collegeAdminA, 'cohort:update', 'cohortA2', true],
  ['collegeA: cannot touch cohort in college B', collegeAdminA, 'cohort:update', 'cohortB1', false],
  ['collegeA: cannot update the institution', collegeAdminA, 'institution:update', 'institution', false],
  ['collegeA: can read the institution', collegeAdminA, 'institution:read', 'institution', true],
  ['collegeB: cannot read cohort of college A', collegeAdminB, 'cohort:read', 'cohortA1', false],

  // Department admin: own department only
  ['deptA1: read own department', deptAdminA1, 'department:read', 'deptA1', true],
  ['deptA1: cannot read sibling department A2', deptAdminA1, 'department:read', 'deptA2', false],
  ['deptA1: cannot read department of college B', deptAdminA1, 'department:read', 'deptB1', false],
  ['deptA1: can read own college', deptAdminA1, 'college:read', 'collegeA', true],
  ['deptA1: cannot read college B', deptAdminA1, 'college:read', 'collegeB', false],
  ['deptA1: cannot update department', deptAdminA1, 'department:update', 'deptA1', false],
  ['deptA1: cannot create program', deptAdminA1, 'program:create', 'deptA1', false],
  ['deptA1: write cohort in own department', deptAdminA1, 'cohort:create', 'cohortA1', true],
  ['deptA1: cannot write cohort in A2', deptAdminA1, 'cohort:create', 'cohortA2', false],
  ['deptA1: cannot write cohort in B1', deptAdminA1, 'cohort:update', 'cohortB1', false],
  ['deptA1: part in own department', deptAdminA1, 'part:update', 'cohortA1', true],
  ['deptA1: part in other department', deptAdminA1, 'part:update', 'cohortA2', false],
  ['deptA1: review registrations of own dept', deptAdminA1, 'registration:review', 'cohortA1', true],
  ['deptA1: cannot review registrations of A2', deptAdminA1, 'registration:review', 'cohortA2', false],
  ['deptA1: create a shared session', deptAdminA1, 'session:create', 'session', true],
  ['deptA1: cannot rename or close a shared session', deptAdminA1, 'session:update', 'session', false],
  ['deptA1: cannot create session in another institution', deptAdminA1, 'session:create', 'otherInstSession', false],
  ['deptB1: cannot read cohort of A1', deptAdminB1, 'cohort:read', 'cohortA1', false],

  // Enrollment (section/part placement)
  ['deptA1: manage enrollment in own department', deptAdminA1, 'enrollment:manage', 'cohortA1', true],
  ['deptA1: cannot manage enrollment in A2', deptAdminA1, 'enrollment:manage', 'cohortA2', false],
  ['deptA1: cannot even read enrollment in B1', deptAdminA1, 'enrollment:read', 'cohortB1', false],
  ['collegeA: manage enrollment in any department of A', collegeAdminA, 'enrollment:manage', 'cohortA2', true],
  ['collegeA: cannot manage enrollment in college B', collegeAdminA, 'enrollment:manage', 'cohortB1', false],
  ['teacher: cannot read enrollment', teacherA1, 'enrollment:read', 'cohortA1', false],
  ['student: cannot manage enrollment', studentA1, 'enrollment:manage', 'cohortA1', false],

  // Staff creation ladder
  ['deptA1: create teacher in own dept', deptAdminA1, 'staff:create:teacher', 'deptA1', true],
  ['deptA1: cannot create teacher in A2', deptAdminA1, 'staff:create:teacher', 'deptA2', false],
  ['deptA1: cannot create department admin', deptAdminA1, 'staff:create:department_admin', 'deptA1', false],
  ['deptA1: cannot create college admin', deptAdminA1, 'staff:create:college_admin', 'collegeA', false],
  ['collegeA: create department admin in own college', collegeAdminA, 'staff:create:department_admin', 'deptA2', true],
  ['collegeA: cannot create department admin in B', collegeAdminA, 'staff:create:department_admin', 'deptB1', false],
  ['collegeA: cannot create college admin', collegeAdminA, 'staff:create:college_admin', 'collegeA', false],
  ['super: create college admin', superAdmin, 'staff:create:college_admin', 'collegeB', true],

  // Teachers and students have no admin power at all
  ['teacher: cannot read cohort', teacherA1, 'cohort:read', 'cohortA1', false],
  ['teacher: cannot manage roster', teacherA1, 'roster:manage', 'cohortA1', false],
  ['student: cannot read department', studentA1, 'department:read', 'deptA1', false],
  ['student: cannot create staff', studentA1, 'staff:create:teacher', 'deptA1', false],
];

describe('policy: can()', () => {
  it.each(table)('%s', (_name, grant, action, resource, expected) => {
    expect(can([grant], action, res[resource])).toBe(expected);
  });

  it('no grants means no access to anything', () => {
    for (const action of ['college:read', 'cohort:create', 'roster:manage', 'staff:create:teacher'] as Action[]) {
      expect(can([], action, res.cohortA1)).toBe(false);
    }
  });

  it('role and area must come from the SAME grant (no mixing)', () => {
    // dept admin in B1 + college admin in A: must not be able to create a department admin in B
    expect(can([deptAdminB1, collegeAdminA], 'staff:create:department_admin', res.deptB1)).toBe(false);
    // but the college admin grant alone covers A
    expect(can([deptAdminB1, collegeAdminA], 'staff:create:department_admin', res.deptA2)).toBe(true);
  });

  it('a grant with a missing id never matches a resource with a missing id', () => {
    const broken: Grant = { role: 'department_admin', scope: { institutionId: I } };
    expect(can([broken], 'cohort:read', { kind: 'cohort', institutionId: I })).toBe(false);
    const brokenCollege: Grant = { role: 'college_admin', scope: { institutionId: I } };
    expect(covers(brokenCollege, { kind: 'cohort', institutionId: I })).toBe(false);
  });
});

describe('policy: viewing and managing other users', () => {
  it('dept admin manages a teacher and a student of own department', () => {
    expect(canManageUser([deptAdminA1], [teacherA1])).toBe(true);
    expect(canManageUser([deptAdminA1], [studentA1])).toBe(true);
  });
  it('dept admin cannot manage a teacher of another department', () => {
    const other: Grant = { role: 'teacher', scope: { institutionId: I, collegeId: CA, departmentId: DA2 } };
    expect(canManageUser([deptAdminA1], [other])).toBe(false);
  });
  it('nobody can manage an equal or higher rank', () => {
    expect(canManageUser([deptAdminA1], [deptAdminA1])).toBe(false);
    expect(canManageUser([deptAdminA1], [collegeAdminA])).toBe(false);
    expect(canManageUser([collegeAdminA], [collegeAdminA])).toBe(false);
    expect(canManageUser([collegeAdminA], [superAdmin])).toBe(false);
  });
  it('even a super admin cannot manage another super admin', () => {
    expect(canManageUser([superAdmin], [superAdmin])).toBe(false);
  });
  it('college admin manages department admins and teachers in own college only', () => {
    expect(canManageUser([collegeAdminA], [deptAdminA1])).toBe(true);
    expect(canManageUser([collegeAdminA], [deptAdminB1])).toBe(false);
  });
  it('a user with several roles needs every role to be manageable', () => {
    const twoRoles = [teacherA1, deptAdminB1];
    expect(canManageUser([collegeAdminA], twoRoles)).toBe(false);
    expect(canManageUser([superAdmin], twoRoles)).toBe(true);
  });
  it('an account with no roles (pending, invited) is managed by super admin only', () => {
    expect(canManageUser([deptAdminA1], [])).toBe(false);
    expect(canManageUser([superAdmin], [])).toBe(true);
  });
  it('teacher and student actors manage nobody', () => {
    expect(canManageUser([teacherA1], [studentA1])).toBe(false);
    expect(canManageUser([studentA1], [studentA1])).toBe(false);
  });

  it('super admin accounts are invisible to everyone but a super admin', () => {
    expect(canViewUser([deptAdminA1], [superAdmin])).toBe(false);
    expect(canViewUser([collegeAdminA], [superAdmin])).toBe(false);
    expect(canViewUser([superAdmin], [superAdmin])).toBe(true);
  });
  it('users in other areas are invisible', () => {
    expect(canViewUser([deptAdminA1], [deptAdminB1])).toBe(false);
    expect(canViewUser([deptAdminA1], [teacherA1])).toBe(true);
    expect(canViewUser([collegeAdminA], [teacherA1])).toBe(true);
  });
  it('a department admin does not see college-level accounts', () => {
    expect(canViewUser([deptAdminA1], [collegeAdminA])).toBe(false);
  });
  it('users without roles are visible to super admin only', () => {
    expect(canViewUser([deptAdminA1], [])).toBe(false);
    expect(canViewUser([superAdmin], [])).toBe(true);
  });
});
