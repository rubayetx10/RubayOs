import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { buildExamProposal, examProblem, findExamConflicts, normalizeDate } from '../src/modules/exams/exam.logic';
import type { OfferingOption } from '../src/modules/routines/routine.import';

const ex = (date: string, start: string, end: string, room = '') => ({ date, startTime: start, endTime: end, room });

describe('normalizeDate', () => {
  it('reads ISO dates', () => { expect(normalizeDate('2026-12-01')).toBe('2026-12-01'); expect(normalizeDate('2026/1/5')).toBe('2026-01-05'); });
  it('reads numeric dates day first', () => {
    expect(normalizeDate('12/03/2026')).toBe('2026-03-12');
    expect(normalizeDate('01-12-2026')).toBe('2026-12-01');
    expect(normalizeDate('5.6.26')).toBe('2026-06-05');
  });
  it('reads dates with month names', () => {
    expect(normalizeDate('12 Dec 2026')).toBe('2026-12-12');
    expect(normalizeDate('1st December, 2026')).toBe('2026-12-01');
    expect(normalizeDate('Dec 12, 2026')).toBe('2026-12-12');
    expect(normalizeDate('3-Jan-27')).toBe('2027-01-03');
  });
  it('rejects dates that do not exist or are not dates', () => {
    for (const d of ['31/02/2026', '2026-13-01', '00/01/2026', 'tomorrow', '', '12 Foo 2026']) expect(normalizeDate(d)).toBeNull();
  });
});

describe('examProblem', () => {
  it('accepts a good slot', () => expect(examProblem(ex('2026-12-01', '10:00', '13:00'))).toBeNull());
  it('rejects a bad date, bad times or end before start', () => {
    expect(examProblem(ex('2026-02-30', '10:00', '13:00'))).toMatch(/real date/);
    expect(examProblem(ex('2026-12-01', '10:00', '9am'))).toMatch(/Times/);
    expect(examProblem(ex('2026-12-01', '13:00', '10:00'))).toMatch(/end after/);
  });
});

describe('findExamConflicts', () => {
  it('flags two exams of one batch at the same time', () => {
    expect(findExamConflicts([ex('2026-12-01', '10:00', '13:00'), ex('2026-12-01', '12:00', '14:00')], []).map((c) => c.kind)).toContain('students');
  });
  it('different days or back-to-back are fine', () => {
    expect(findExamConflicts([ex('2026-12-01', '10:00', '13:00'), ex('2026-12-02', '10:00', '13:00'), ex('2026-12-01', '13:00', '15:00')], [])).toEqual([]);
  });
  it('flags a room used by another batch at the same time, ignoring case', () => {
    const c = findExamConflicts([ex('2026-12-01', '10:00', '13:00', 'Hall 1')], [{ ...ex('2026-12-01', '11:00', '12:00', ' hall 1 '), label: 'another batch’s Final' }]);
    expect(c).toHaveLength(1);
    expect(c[0]!.kind).toBe('room');
  });
  it('an empty room never clashes', () => expect(findExamConflicts([ex('2026-12-01', '10:00', '13:00')], [{ ...ex('2026-12-01', '10:00', '13:00'), label: 'x' }])).toEqual([]));
});

describe('buildExamProposal', () => {
  const offerings: OfferingOption[] = [{ id: 'o1', code: 'CSE 101', name: 'Programming', teachers: [] }];
  const rows = buildExamProposal(
    [{ date: '12/03/2026', start: '10:00', end: '1:00 PM', courseCode: 'cse101', room: '301', title: 'Mid Term' }, { date: 'soon', start: '10:00', courseCode: 'ZZ 1' }],
    offerings, 'Exam',
  );
  it('turns a clean row into a ready row', () => expect(rows[0]).toMatchObject({ date: '2026-03-12', startTime: '10:00', endTime: '13:00', offeringId: 'o1', matchedBy: 'code', title: 'Mid Term', problems: [] }));
  it('lists every doubt for a broken row, and defaults the title', () => {
    expect(rows[1]!.title).toBe('Exam');
    expect(rows[1]!.problems).toEqual(['Date not recognised', 'Time not recognised', 'Course not found in this semester’s courses. Choose it.']);
  });
});

describe('exam API is locked', () => {
  const app = createApp();
  const id = '507f1f77bcf86cd799439011';
  for (const [method, path] of [['get', `/api/v1/exams?cohortId=${id}&semesterId=${id}`], ['post', '/api/v1/exams/bulk'], ['post', '/api/v1/exams/publish'], ['post', '/api/v1/exams/import'], ['patch', `/api/v1/exams/${id}`], ['get', '/api/v1/exam/me']] as const) {
    it(`${method.toUpperCase()} ${path.split('?')[0].replace(id, ':id')} needs a login`, async () => {
      expect((await request(app)[method](path)).status).toBe(401);
    });
  }
});
