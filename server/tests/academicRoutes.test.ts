import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();
const id = '507f1f77bcf86cd799439011';
const entities = ['institutions', 'colleges', 'departments', 'programs', 'sessions', 'cohorts', 'semesters', 'sections', 'parts'];

// The academic admin API used to be open (Step 1.2). From Step 1.4 nothing is reachable without a login.
describe('academic API is locked', () => {
  for (const e of entities) {
    it(`GET /academic/${e} needs a login`, async () => {
      expect((await request(app).get(`/api/v1/academic/${e}`)).status).toBe(401);
    });
    it(`POST /academic/${e} needs a login`, async () => {
      expect((await request(app).post(`/api/v1/academic/${e}`).send({})).status).toBe(401);
    });
    it(`PATCH /academic/${e}/:id needs a login`, async () => {
      expect((await request(app).patch(`/api/v1/academic/${e}/${id}`).send({})).status).toBe(401);
    });
  }
  it('a forged token is refused', async () => {
    const res = await request(app).get('/api/v1/academic/colleges').set('Authorization', 'Bearer forged.token.value');
    expect(res.status).toBe(401);
  });
  it('the old open route no longer leaks data without a token', async () => {
    const res = await request(app).get('/api/v1/academic/programs');
    expect(res.body.success).toBe(false);
  });
});

describe('user management API is locked', () => {
  for (const [method, path] of [
    ['get', '/api/v1/users'],
    ['get', `/api/v1/users/${id}`],
    ['post', `/api/v1/users/${id}/deactivate`],
    ['post', `/api/v1/users/${id}/reactivate`],
    ['post', `/api/v1/users/${id}/roles`],
    ['delete', `/api/v1/users/${id}/roles/${id}`],
  ] as const) {
    it(`${method.toUpperCase()} ${path} needs a login`, async () => {
      expect((await request(app)[method](path)).status).toBe(401);
    });
  }
});
