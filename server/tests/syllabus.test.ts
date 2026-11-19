import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { cleanSyllabus, diffSyllabus, parseSyllabusJson } from '../src/modules/syllabus/syllabus.logic';

describe('cleanSyllabus', () => {
  it('trims, drops empty and repeated lines, keeps order', () => {
    const c = cleanSyllabus({ objectives: ['  Learn  X ', '', 'learn x', 'Learn Y'], topics: [{ title: ' Unit 1 ', subtopics: ['a', ' a ', '', 'b'] }, { title: '   ', subtopics: ['z'] }, { title: 'Unit 2' }] });
    expect(c.objectives).toEqual(['Learn X', 'Learn Y']);
    expect(c.topics).toEqual([{ title: 'Unit 1', subtopics: ['a', 'b'] }, { title: 'Unit 2', subtopics: [] }]);
  });
  it('survives rubbish input', () => expect(cleanSyllabus({ objectives: 'x', topics: [null, 5, 'a'] })).toEqual({ objectives: [], topics: [] }));
  it('applies limits', () => {
    const c = cleanSyllabus({ topics: Array.from({ length: 150 }, (_, i) => ({ title: `T${i}` })) });
    expect(c.topics).toHaveLength(100);
    expect(cleanSyllabus({ objectives: ['x'.repeat(500)] }).objectives[0]).toHaveLength(300);
  });
});

describe('diffSyllabus', () => {
  const v1 = { objectives: ['A'], topics: [{ title: 'Unit 1', subtopics: ['a', 'b'] }, { title: 'Unit 2', subtopics: [] }] };
  it('describes a first version', () => expect(diffSyllabus(null, v1)).toEqual(['First published syllabus: 2 topic(s), 1 objective(s)']));
  it('counts added, removed and changed parts', () => {
    const v2 = { objectives: ['A', 'B'], topics: [{ title: 'unit 1', subtopics: ['a', 'c'] }, { title: 'Unit 3', subtopics: [] }] };
    expect(diffSyllabus(v1, v2)).toEqual(['1 topic(s) added', '1 topic(s) removed', '2 subtopic(s) changed', '1 objective(s) changed']);
  });
  it('says so when nothing changed', () => expect(diffSyllabus(v1, structuredClone(v1))).toEqual(['No change']));
});

describe('parseSyllabusJson', () => {
  it('reads the AI answer, with or without fences, and cleans it', () => {
    const r = parseSyllabusJson('```json\n{"objectives":["Know X"],"topics":[{"title":"Unit 1","subtopics":["a"]},{"title":"Unit 2"}],"notes":"ok"}\n```');
    expect(r.body.topics).toEqual([{ title: 'Unit 1', subtopics: ['a'] }, { title: 'Unit 2', subtopics: [] }]);
    expect(r.notes).toBe('ok');
  });
  it('objectives are optional', () => expect(parseSyllabusJson('{"topics":[]}').body).toEqual({ objectives: [], topics: [] }));
  it('throws on anything else', () => {
    expect(() => parseSyllabusJson('I could not read it')).toThrow();
    expect(() => parseSyllabusJson('{"entries":[]}')).toThrow();
  });
});

describe('syllabus API is locked', () => {
  const app = createApp();
  const id = '507f1f77bcf86cd799439011';
  for (const [method, path] of [['get', `/api/v1/syllabus?courseId=${id}`], ['put', '/api/v1/syllabus/draft'], ['post', '/api/v1/syllabus/publish'], ['post', '/api/v1/syllabus/restore'], ['post', '/api/v1/syllabus/import'], ['get', '/api/v1/my-courses/me']] as const) {
    it(`${method.toUpperCase()} ${path.split('?')[0]} needs a login`, async () => {
      expect((await request(app)[method](path)).status).toBe(401);
    });
  }
});
