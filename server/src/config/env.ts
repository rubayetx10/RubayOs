import 'dotenv/config';
import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CLIENT_ORIGIN: z.string().url(),
    APP_URL: z.string().url().optional(),
    MONGODB_URI: z.string().optional(),

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    ACCESS_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TTL_DAYS_STUDENT: z.coerce.number().int().min(1).max(90).default(30),
    REFRESH_TTL_DAYS_STAFF: z.coerce.number().int().min(1).max(90).default(7),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(465),
    SMTP_SECURE: z.enum(['true', 'false']).default('true'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('RubayOS <no-reply@rubayos.local>'),

    LOCAL_STORAGE_ROOT: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== 'test') {
      if (!v.MONGODB_URI) ctx.addIssue({ code: 'custom', path: ['MONGODB_URI'], message: 'MONGODB_URI is required' });
      if (!v.JWT_ACCESS_SECRET) ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'JWT_ACCESS_SECRET is required' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const appUrl = env.APP_URL ?? env.CLIENT_ORIGIN;
