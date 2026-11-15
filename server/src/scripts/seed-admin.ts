import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../config/logger';
import { hashPassword } from '../modules/auth/password';
import { passwordSchema } from '../modules/auth/auth.schemas';
import { RoleAssignment, User } from '../modules/auth/auth.models';
import { Institution } from '../modules/academic/academic.models';

/**
 * Creates the first Super Admin. Pass credentials on the command line so the password
 * never sits in a file:
 *   SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='...' npm run seed:admin -w server
 */
async function main() {
  const email = process.env['SUPER_ADMIN_EMAIL']?.trim().toLowerCase();
  const password = process.env['SUPER_ADMIN_PASSWORD'];
  const name = process.env['SUPER_ADMIN_NAME']?.trim() || 'Super Admin';
  if (!email || !password) throw new Error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD');
  const check = passwordSchema.safeParse(password);
  if (!check.success) throw new Error(check.error.issues.map((i) => i.message).join('; '));

  await connectDb();
  if (await User.exists({ email })) {
    logger.info('A user with this email already exists. Nothing changed.');
    return;
  }
  const user = await User.create({ name, email, passwordHash: await hashPassword(password), status: 'active' });
  const institution = await Institution.findOne({ shortName: 'NU' }).lean();
  await RoleAssignment.create({ userId: user._id, role: 'super_admin', scope: { institutionId: institution?._id ?? null } });
  logger.info({ email }, 'Super Admin created');
}

main()
  .catch((err) => {
    logger.fatal({ err: String(err?.message ?? err) }, 'Seed admin failed');
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
