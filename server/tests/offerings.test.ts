import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { planCourseEnrollments, type OfferingRef, type StudentRef } from '../src/modules/offerings/offering.logic';

const st = (n: string, sectionId: string | null = null): StudentRef => ({ profileId: `p${n}`, userId: `u${n}`, sectionId });
const off = (id: string, type: OfferingRef['type'] = 'theory', sectionIds: string[] = []): OfferingRef => ({ id, type, sectionIds });
const none = new Set<string>();

describe('planCourseEnrollments', () => {
  it('enrolls every student in every compulsory course', () => {
    const plan = planCourseEnrollments([st('1'), st('2')], [off('c1'), off('c2', 'lab')], none);
    expect(plan).toHaveLength(4);
    expect(plan).toContainEqual({ profileId: 'p2', userId: 'u2', offeringId: 'c2' });
  });
  it('never adds electives by itself', () => expect(planCourseEnrollments([st('1')], [off('e1', 'elective')], none)).toEqual([]));
  it('skips pairs that already exist (safe to run again)', () => {
    const plan = planCourseEnrollments([st('1'), st('2')], [off('c1')], new Set(['p1:c1']));
    expect(plan.map((p) => p.profileId)).toEqual(['p2']);
  });
  it('a course for some sections only takes students placed in those sections', () => {
    const plan = planCourseEnrollments([st('1', 'sA'), st('2', 'sB'), st('3', null)], [off('c1', 'theory', ['sA'])], none);
    expect(plan.map((p) => p.profileId)).toEqual(['p1']);
  });
  it('a course with no section limit takes students who have no section yet', () => {
    expect(planCourseEnrollments([st('1', null)], [off('c1')], none)).toHaveLength(1);
  });
  it('no students or no offerings gives nothing', () => {
    expect(planCourseEnrollments([], [off('c1')], none)).toEqual([]);
    expect(planCourseEnrollments([st('1')], [], none)).toEqual([]);
  });
});

describe('offerings API is locked', () => {
  const app = createApp();
  const id = '507f1f77bcf86cd799439011';
  for (const [method, path] of [['get', `/api/v1/offerings?cohortId=${id}&semesterId=${id}`], ['post', '/api/v1/offerings/generate'], ['post', '/api/v1/offerings/sync'], ['patch', `/api/v1/offerings/${id}`]] as const) {
    it(`${method.toUpperCase()} ${path.split('?')[0].replace(id, ':id')} needs a login`, async () => {
      expect((await request(app)[method](path)).status).toBe(401);
    });
  }
});
