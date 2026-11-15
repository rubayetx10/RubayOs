import { z } from 'zod';
import { objectId } from '../academic/academic.schemas';

const COMMON = new Set(['password', '12345678', '123456789', 'qwertyuiop', '11111111', 'iloveyou', 'password1', 'abcd1234']);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .refine((p) => !COMMON.has(p.toLowerCase()), 'This password is too common');

export const registrationNoSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{4,25}$/, 'Registration number must be 4 to 25 letters, digits or dashes');

export const registerSchema = z
  .object({
    departmentId: objectId,
    name: z.string().trim().min(2).max(120),
    registrationNo: registrationNoSchema,
    classRoll: z.number().int().min(1).max(9999),
    email: z.string().trim().toLowerCase().email().max(160),
    password: passwordSchema,
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({ identifier: z.string().trim().min(3).max(160), password: z.string().min(1).max(128) })
  .strict();

export const forgotSchema = z.object({ identifier: z.string().trim().min(3).max(160) }).strict();
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
