import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { audienceOf, chunk, excerpt } from '../src/modules/notifications/notify.logic';

describe('audienceOf', () => {
  it('college and department notices go to every active student there', () => {
    expect(audienceOf({ scope: 'college', collegeId: 'C1' })).toEqual({ kind: 'profiles', filter: { collegeId: 'C1', status: 'active' } });
    expect(audienceOf({ scope: 'department', departmentId: 'D1' })).toEqual({ kind: 'profiles', filter: { departmentId: 'D1', status: 'active' } });
  });
  it('a batch notice can narrow to a semester and to sections', () => {
    expect(audienceOf({ scope: 'cohort', cohortId: 'K1' })).toEqual({ kind: 'profiles', filter: { cohortId: 'K1', status: 'active' } });
    expect(audienceOf({ scope: 'cohort', cohortId: 'K1', semesterId: 'S1', sectionIds: ['A', 'B'] })).toEqual({ kind: 'profiles', filter: { cohortId: 'K1', status: 'active', currentSemesterId: 'S1', sectionId: { $in: ['A', 'B'] } } });
  });
  it('a course notice goes to that course’s enrolled students', () => expect(audienceOf({ scope: 'course', offeringId: 'o1' })).toEqual({ kind: 'offering', offeringId: 'o1' }));
  it('a target with a missing id reaches nobody', () => {
    for (const scope of ['college', 'department', 'cohort', 'course'] as const) expect(audienceOf({ scope })).toBeNull();
  });
});

describe('excerpt and chunk', () => {
  it('shortens long text on one line', () => {
    expect(excerpt('  hello\n\n  world  ')).toBe('hello world');
    const long = excerpt('word '.repeat(100), 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
  });
  it('splits a list into parts of at most n', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe('notification API is locked', () => {
  const app = createApp();
  const id = '507f1f77bcf86cd799439011';
  for (const [method, path] of [['get', '/api/v1/notifications'], ['post', '/api/v1/notifications/read-all'], ['post', `/api/v1/notifications/${id}/read`]] as const) {
    it(`${method.toUpperCase()} ${path.replace(id, ':id')} needs a login`, async () => {
      expect((await request(app)[method](path)).status).toBe(401);
    });
  }
});
