import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();
const id = '507f1f77bcf86cd799439011';

// These run without a database: validation rejects bad input before any query.
describe('academic routes validation', () => {
  it('rejects a part with min greater than max shape-wise (missing fields)', async () => {
    const res = await request(app).post('/api/v1/academic/parts').send({ sectionId: id, name: 'P1' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('rejects a malformed id in the path', async () => {
    const res = await request(app).get('/api/v1/academic/colleges/not-an-id');
    expect(res.status).toBe(422);
  });
  it('rejects a malformed filter id', async () => {
    const res = await request(app).get('/api/v1/academic/sections?semesterId=bad');
    expect(res.status).toBe(422);
  });
  it('semesters cannot be created directly', async () => {
    const res = await request(app).post('/api/v1/academic/semesters').send({ cohortId: id, number: 1 });
    expect(res.status).toBe(404);
  });
  it('there is no DELETE endpoint (history is preserved)', async () => {
    const res = await request(app).delete(`/api/v1/academic/colleges/${id}`);
    expect(res.status).toBe(404);
  });
});
