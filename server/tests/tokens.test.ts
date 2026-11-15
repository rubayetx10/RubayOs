import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { refreshCookieOptions, signAccessToken, verifyAccessToken } from '../src/modules/auth/tokens';
import { hashPassword, verifyPassword } from '../src/modules/auth/password';
import { passwordSchema, registerSchema } from '../src/modules/auth/auth.schemas';
import { randomToken, sha256 } from '../src/common/crypto';

const SECRET = 'test-secret-test-secret-test-secret-1234';
const id = '507f1f77bcf86cd799439011';

describe('access tokens', () => {
  it('round-trips claims', () => {
    const t = signAccessToken({ userId: 'u1', familyId: 'f1', rolesVersion: 3 });
    expect(verifyAccessToken(t)).toEqual({ userId: 'u1', familyId: 'f1', rolesVersion: 3 });
  });
  it('rejects a token signed with another secret', () => {
    const bad = jwt.sign({ fid: 'f', rv: 0 }, 'another-secret-another-secret-another!!', { subject: 'u', expiresIn: '5m' });
    expect(() => verifyAccessToken(bad)).toThrow();
  });
  it('rejects an expired token', () => {
    const old = jwt.sign({ fid: 'f', rv: 0 }, SECRET, { subject: 'u', expiresIn: -10 });
    expect(() => verifyAccessToken(old)).toThrow();
  });
  it('rejects alg=none tokens', () => {
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"u","fid":"f","rv":0}').toString('base64url')}.`;
    expect(() => verifyAccessToken(none)).toThrow();
  });
  it('rejects garbage', () => expect(() => verifyAccessToken('not.a.token')).toThrow());
});

describe('refresh cookie', () => {
  it('is HttpOnly, SameSite=Lax and limited to the auth path', () => {
    const o = refreshCookieOptions(new Date());
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe('lax');
    expect(o.path).toBe('/api/v1/auth');
  });
});

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const h = await hashPassword('Correct-Horse-9');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'Correct-Horse-9')).toBe(true);
    expect(await verifyPassword(h, 'wrong-password')).toBe(false);
  });
  it('never stores the same hash twice (salted)', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });
  it('enforces length and blocks very common passwords', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
    expect(passwordSchema.safeParse('Good-pass-2026').success).toBe(true);
  });
});

describe('registerSchema', () => {
  const ok = { departmentId: id, name: 'Rahim Uddin', registrationNo: '1234567890', classRoll: 15, email: 'Rahim@Example.com', password: 'Good-pass-2026' };
  it('accepts a valid body and lowercases the email', () => {
    const r = registerSchema.safeParse(ok);
    expect(r.success && r.data.email).toBe('rahim@example.com');
  });
  it('rejects extra fields such as a client-chosen role or cohort', () => {
    expect(registerSchema.safeParse({ ...ok, role: 'super_admin' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, cohortId: id }).success).toBe(false);
  });
  it('rejects a non-integer roll', () => expect(registerSchema.safeParse({ ...ok, classRoll: 15.5 }).success).toBe(false));
});

describe('crypto helpers', () => {
  it('sha256 is stable and random tokens differ', () => {
    expect(sha256('a')).toBe(sha256('a'));
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken(32).length).toBeGreaterThanOrEqual(40);
  });
});
