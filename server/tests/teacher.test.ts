import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { teacherSlots, type VersionLike } from '../src/modules/teacher/teacher.logic';

const e = (day: number, start: string, teacherId: string | null, offeringId = 'o1') => ({ day, startTime: start, endTime: '23:00', offeringId, teacherId, room: 'R1' });

describe('teacherSlots', () => {
  const versions: VersionLike[] = [
    { sectionId: 'sA', entries: [e(2, '10:00', 't1'), e(0, '09:00', 't2'), e(0, '11:00', 't1')] },
    { sectionId: 'sB', entries: [e(0, '08:00', 't1', 'o2'), e(1, '09:00', null)] },
  ];
  it('collects only this teacher’s classes across sections, in day and time order', () => {
    expect(teacherSlots(versions, 't1').map((s) => [s.day, s.startTime, s.sectionId])).toEqual([[0, '08:00', 'sB'], [0, '11:00', 'sA'], [2, '10:00', 'sA']]);
  });
  it('gives nothing for a teacher with no classes, and ignores classes without a teacher', () => {
    expect(teacherSlots(versions, 't9')).toEqual([]);
    expect(teacherSlots([{ sectionId: 's', entries: [e(1, '09:00', null)] }], '')).toEqual([]);
  });
});

describe('teacher API is locked', () => {
  const app = createApp();
  const id = '507f1f77bcf86cd799439011';
  for (const path of ['/api/v1/teacher/me', `/api/v1/teacher/offerings/${id}/students`]) {
    it(`GET ${path.replace(id, ':id')} needs a login`, async () => {
      expect((await request(app).get(path)).status).toBe(401);
    });
  }
});
