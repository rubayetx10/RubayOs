/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { isVisibleToStudent, studentNoticeFilter, type NoticeLike, type StudentCtx } from '../src/modules/notices/notice.logic';

const student: StudentCtx = { collegeId: 'C1', departmentId: 'D1', cohortId: 'K1', semesterId: 'S1', sectionId: 'A', offeringIds: new Set(['o1']) };
const now = new Date('2026-12-01T10:00:00Z');
const past = new Date('2026-11-01T00:00:00Z');
const future = new Date('2027-01-01T00:00:00Z');
const notice = (target: NoticeLike['target'], extra: Partial<NoticeLike> = {}): NoticeLike => ({ target, status: 'active', publishAt: past, expiresAt: null, ...extra });
const sees = (n: NoticeLike, s: StudentCtx = student) => isVisibleToStudent(n, s, now);

describe('who sees a notice', () => {
  it('college notice: only that college', () => {
    expect(sees(notice({ scope: 'college', collegeId: 'C1' }))).toBe(true);
    expect(sees(notice({ scope: 'college', collegeId: 'C2' }))).toBe(false);
  });
  it('department notice: only that department', () => {
    expect(sees(notice({ scope: 'department', departmentId: 'D1' }))).toBe(true);
    expect(sees(notice({ scope: 'department', departmentId: 'D2' }))).toBe(false);
  });
  it('batch notice: only that batch', () => {
    expect(sees(notice({ scope: 'cohort', cohortId: 'K1' }))).toBe(true);
    expect(sees(notice({ scope: 'cohort', cohortId: 'K2' }))).toBe(false);
  });
  it('batch notice for one semester: only students currently in it', () => {
    expect(sees(notice({ scope: 'cohort', cohortId: 'K1', semesterId: 'S1' }))).toBe(true);
    expect(sees(notice({ scope: 'cohort', cohortId: 'K1', semesterId: 'S2' }))).toBe(false);
  });
  it('batch notice for some sections: only students placed in them', () => {
    expect(sees(notice({ scope: 'cohort', cohortId: 'K1', sectionIds: ['A', 'B'] }))).toBe(true);
    expect(sees(notice({ scope: 'cohort', cohortId: 'K1', sectionIds: ['B'] }))).toBe(false);
    expect(sees(notice({ scope: 'cohort', cohortId: 'K1', sectionIds: ['A'] }), { ...student, sectionId: null })).toBe(false);
    expect(sees(notice({ scope: 'cohort', cohortId: 'K1', sectionIds: [] }), { ...student, sectionId: null })).toBe(true);
  });
  it('course notice: only students enrolled in that course', () => {
    expect(sees(notice({ scope: 'course', offeringId: 'o1' }))).toBe(true);
    expect(sees(notice({ scope: 'course', offeringId: 'o2' }))).toBe(false);
  });
  it('a notice with a missing id in its target is seen by nobody', () => {
    for (const scope of ['college', 'department', 'cohort', 'course'] as const) expect(sees(notice({ scope }))).toBe(false);
  });
  it('withdrawn, not yet published and expired notices are hidden', () => {
    const t = { scope: 'cohort', cohortId: 'K1' } as const;
    expect(sees(notice(t, { status: 'withdrawn' }))).toBe(false);
    expect(sees(notice(t, { publishAt: future }))).toBe(false);
    expect(sees(notice(t, { expiresAt: past }))).toBe(false);
    expect(sees(notice(t, { expiresAt: future }))).toBe(true);
  });
});

describe('studentNoticeFilter', () => {
  const f = studentNoticeFilter(student, now) as any;
  const branches = f.$and[1].$or as any[];
  it('only asks for active, already published notices that have not expired', () => {
    expect(f.status).toBe('active');
    expect(f.publishAt).toEqual({ $lte: now });
    expect(f.$and[0]).toEqual({ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });
  });
  it('has one branch per audience, tied to this student’s own ids', () => {
    expect(branches).toHaveLength(4);
    expect(branches[0]).toEqual({ 'target.scope': 'college', 'target.collegeId': 'C1' });
    expect(branches[1]).toEqual({ 'target.scope': 'department', 'target.departmentId': 'D1' });
    expect(branches[2]['target.cohortId']).toBe('K1');
    expect(branches[3]).toEqual({ 'target.scope': 'course', 'target.offeringId': { $in: ['o1'] } });
  });
  it('a student with no section only matches notices that name no sections', () => {
    const g = (studentNoticeFilter({ ...student, sectionId: null }, now) as any).$and[1].$or[2].$and[1].$or;
    expect(g).toEqual([{ 'target.sectionIds': { $size: 0 } }]);
  });
  it('a student in no course matches no course notice', () => {
    expect((studentNoticeFilter({ ...student, offeringIds: new Set() }, now) as any).$and[1].$or[3]['target.offeringId']).toEqual({ $in: [] });
  });
});

describe('notice API is locked', () => {
  const app = createApp();
  const id = '507f1f77bcf86cd799439011';
  for (const [method, path] of [['get', '/api/v1/notices'], ['post', '/api/v1/notices'], ['patch', `/api/v1/notices/${id}`], ['post', `/api/v1/notices/${id}/withdraw`], ['get', '/api/v1/my-notices'], ['post', `/api/v1/my-notices/${id}/read`]] as const) {
    it(`${method.toUpperCase()} ${path.replace(id, ':id')} needs a login`, async () => {
      expect((await request(app)[method](path)).status).toBe(401);
    });
  }
});
