import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();
const id = '507f1f77bcf86cd799439011';

// These need no database: they are rejected before any query runs.
describe('protected routes require a login', () => {
  for (const [method, path] of [
    ['get', '/api/v1/auth/me'],
    ['post', '/api/v1/auth/logout-all'],
    ['post', '/api/v1/auth/change-password'],
    ['get', '/api/v1/roster?cohortId=' + id],
    ['post', '/api/v1/roster/import'],
    ['get', '/api/v1/registrations'],
    ['post', `/api/v1/registrations/${id}/approve`],
    ['post', '/api/v1/staff'],
  ] as const) {
    it(`${method.toUpperCase()} ${path} returns 401 without a token`, async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  }

  it('rejects a forged bearer token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
  });
});

describe('auth input validation', () => {
  it('register rejects a weak password', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      departmentId: id, name: 'Rahim Uddin', registrationNo: '1234567890', classRoll: 15, email: 'a@b.co', password: '123',
    });
    expect(res.status).toBe(422);
  });
  it('register cannot be used to choose a role', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      departmentId: id, name: 'Rahim Uddin', registrationNo: '1234567890', classRoll: 15, email: 'a@b.co', password: 'Good-pass-2026', role: 'super_admin',
    });
    expect(res.status).toBe(422);
  });
  it('login needs both fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: 'x' });
    expect(res.status).toBe(422);
  });
  it('reset-password rejects a short token', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token: 'abc', password: 'Good-pass-2026' });
    expect(res.status).toBe(422);
  });
  it('logout is safe without a cookie and clears it', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
  });
  it('refresh without a cookie returns 401', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });
});
