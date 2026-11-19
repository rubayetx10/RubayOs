import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { diffEntries, findConflicts, slotProblem, toMinutes, type Slot } from '../src/modules/routines/routine.logic';

const slot = (day: number, start: string, end: string, extra: Partial<Slot> = {}): Slot => ({ day, startTime: start, endTime: end, offeringId: 'o1', ...extra });

describe('times', () => {
  it('reads 24h times', () => { expect(toMinutes('09:30')).toBe(570); expect(toMinutes('00:00')).toBe(0); });
  it('rejects bad times', () => { for (const t of ['9:30', '24:00', '12:60', 'noon', '']) expect(toMinutes(t)).toBeNull(); });
  it('a slot must end after it starts and use a real day', () => {
    expect(slotProblem(slot(1, '10:00', '11:00'))).toBeNull();
    expect(slotProblem(slot(1, '11:00', '10:00'))).toMatch(/end after/);
    expect(slotProblem(slot(1, '10:00', '10:00'))).toMatch(/end after/);
    expect(slotProblem(slot(7, '10:00', '11:00'))).toMatch(/Day/);
    expect(slotProblem(slot(1, '10:00', '1100'))).toMatch(/Times/);
  });
});

describe('findConflicts', () => {
  it('flags two classes at the same time in one section', () => {
    const c = findConflicts([slot(0, '10:00', '11:00'), slot(0, '10:30', '11:30', { offeringId: 'o2' })], []);
    expect(c.map((x) => x.kind)).toEqual(['section']);
  });
  it('back-to-back classes are fine', () => expect(findConflicts([slot(0, '10:00', '11:00'), slot(0, '11:00', '12:00')], [])).toEqual([]));
  it('the same time on another day is fine', () => expect(findConflicts([slot(0, '10:00', '11:00'), slot(1, '10:00', '11:00')], [])).toEqual([]));
  it('flags a teacher who is teaching another section at the same time', () => {
    const c = findConflicts([slot(2, '09:00', '10:00', { teacherId: 't1' })], [{ ...slot(2, '09:30', '10:30', { teacherId: 't1' }), label: 'section B' }]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: 'teacher' });
    expect(c[0]!.message).toContain('section B');
  });
  it('a different teacher is fine', () => {
    expect(findConflicts([slot(2, '09:00', '10:00', { teacherId: 't1' })], [{ ...slot(2, '09:00', '10:00', { teacherId: 't2' }), label: 'section B' }])).toEqual([]);
  });
  it('flags a room used twice, ignoring case and spaces, but not an empty room', () => {
    const others = [{ ...slot(3, '10:00', '11:00', { room: ' lab 1 ' }), label: 'section C' }];
    expect(findConflicts([slot(3, '10:30', '11:30', { room: 'LAB 1' })], others)[0]?.kind).toBe('room');
    expect(findConflicts([slot(3, '10:30', '11:30', { room: '' })], [{ ...others[0]!, room: '' }])).toEqual([]);
  });
});

describe('diffEntries', () => {
  it('describes a first version', () => expect(diffEntries(null, [slot(0, '10:00', '11:00')])).toEqual(['First published routine with 1 class(es)']));
  it('counts added and removed classes', () => {
    const prev = [slot(0, '10:00', '11:00'), slot(1, '10:00', '11:00')];
    const next = [slot(0, '10:00', '11:00'), slot(2, '10:00', '11:00'), slot(3, '10:00', '11:00')];
    expect(diffEntries(prev, next)).toEqual(['2 class(es) added or changed', '1 class(es) removed or changed']);
  });
  it('says so when nothing changed', () => expect(diffEntries([slot(0, '10:00', '11:00')], [slot(0, '10:00', '11:00')])).toEqual(['No change in classes']));
});

describe('routine API is locked', () => {
  const app = createApp();
  const id = '507f1f77bcf86cd799439011';
  const q = `cohortId=${id}&semesterId=${id}&sectionId=${id}`;
  for (const [method, path] of [['get', `/api/v1/routines?${q}`], ['put', '/api/v1/routines/draft'], ['post', '/api/v1/routines/publish'], ['post', '/api/v1/routines/restore'], ['get', '/api/v1/routine/me']] as const) {
    it(`${method.toUpperCase()} ${path.split('?')[0]} needs a login`, async () => {
      expect((await request(app)[method](path)).status).toBe(401);
    });
  }
});
