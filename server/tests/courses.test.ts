import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { detectCourseMapping, mapCourseRows, validateCourseRows } from '../src/modules/courses/courseImport';
import { parseCsv } from '../src/modules/roster/rosterImport';

describe('course file columns', () => {
  it('finds common column names', () => {
    const r = detectCourseMapping(['SL', 'Course Code', 'Course Title', 'Credit', 'Semester', 'Type']);
    expect(r.mapping).toEqual({ code: 'Course Code', name: 'Course Title', credit: 'Credit', semesterNumber: 'Semester', type: 'Type' });
  });
  it('type is optional', () => expect(detectCourseMapping(['Code', 'Name', 'Credits', 'Sem']).mapping).toBeDefined());
  it('reports missing columns', () => expect(detectCourseMapping(['Code', 'Name']).missing).toEqual(['credit', 'semesterNumber']));
});

describe('course rows', () => {
  const rows = (csv: string) => {
    const { headers, rows: data } = parseCsv(csv);
    return validateCourseRows(mapCourseRows(data, detectCourseMapping(headers).mapping!));
  };
  it('reads good rows, upper-cases codes and understands types and "3rd" style semesters', () => {
    const { valid, errors } = rows('Code,Name,Credit,Semester,Type\nabc 101,Intro to X,3,1,Theory\nabc 102,X Lab,1.5,3rd,Sessional\n');
    expect(errors).toEqual([]);
    expect(valid).toEqual([
      { rowNo: 2, code: 'ABC 101', name: 'Intro to X', credit: 3, semesterNumber: 1, type: 'theory' },
      { rowNo: 3, code: 'ABC 102', name: 'X Lab', credit: 1.5, semesterNumber: 3, type: 'lab' },
    ]);
  });
  it('rejects bad credit, semester, code and name with sheet row numbers', () => {
    const { valid, errors } = rows('Code,Name,Credit,Semester\n,Name,3,1\nA1,N,3,1\nA2,Good,0,1\nA3,Good,3,0\nA4,Good,abc,1\nA5,Good,3,x\n');
    expect(valid).toHaveLength(0);
    expect(errors.map((e) => e.rowNo)).toEqual([2, 3, 4, 5, 6, 7]);
  });
  it('flags duplicate codes inside the file and keeps the clean rows', () => {
    const { valid, errors } = rows('Code,Name,Credit,Semester\nA1,One,3,1\nA1,Again,3,1\nA2,Two,3,1\n');
    expect(valid.map((v) => v.code)).toEqual(['A2']);
    expect(errors).toHaveLength(2);
  });
  it('an empty type means theory', () => expect(rows('Code,Name,Credit,Semester,Type\nA1,One,3,1,\n').valid[0]?.type).toBe('theory'));
});

describe('course API is locked', () => {
  const app = createApp();
  const id = '507f1f77bcf86cd799439011';
  for (const [method, path] of [['get', '/api/v1/courses'], ['post', '/api/v1/courses'], ['patch', `/api/v1/courses/${id}`], ['post', '/api/v1/courses/import']] as const) {
    it(`${method.toUpperCase()} ${path.replace(id, ':id')} needs a login`, async () => {
      expect((await request(app)[method](path)).status).toBe(401);
    });
  }
});
