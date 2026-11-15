import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../config/logger';
import { College, Department, Institution } from '../modules/academic/academic.models';
import { RoleAssignment, User } from '../modules/auth/auth.models';
import { hashPassword } from '../modules/auth/password';
import { removeSmokeStaff } from './cleanup-smoke';

/**
 * Creates fake staff for docs/api/step-1.4-smoke-test.sh: a department admin for Dhaka City College CSE,
 * a department admin for a separate "Smoke College B", and a teacher. Remove with: npm run cleanup:smoke -w server
 */
export const SMOKE_PASSWORD = 'Smoke-admin-2026';
export const SMOKE_DOMAIN = '@smoke.rubayos.test';

async function main() {
  await connectDb();
  const inst = await Institution.findOne({ shortName: 'NU' });
  const college = inst && (await College.findOne({ institutionId: inst._id, code: 'DCC' }));
  const dept = college && (await Department.findOne({ collegeId: college._id, code: 'CSE' }));
  if (!inst || !college || !dept) throw new Error('Run "npm run seed -w server" first (needs Dhaka City College CSE)');

  await removeSmokeStaff();

  const collegeB = await College.findOneAndUpdate(
    { institutionId: inst._id, code: 'SMOKEB' },
    { $setOnInsert: { name: 'Smoke College B' } },
    { upsert: true, new: true },
  );
  const deptB = await Department.findOneAndUpdate(
    { collegeId: collegeB._id, code: 'SMOKEDB' },
    { $setOnInsert: { name: 'Smoke Dept B', institutionId: inst._id } },
    { upsert: true, new: true },
  );

  const passwordHash = await hashPassword(SMOKE_PASSWORD);
  const people = [
    { key: 'admin-a', name: 'Smoke Admin A', role: 'department_admin', scope: { institutionId: inst._id, collegeId: college._id, departmentId: dept._id } },
    { key: 'admin-b', name: 'Smoke Admin B', role: 'department_admin', scope: { institutionId: inst._id, collegeId: collegeB._id, departmentId: deptB._id } },
    { key: 'teacher', name: 'Smoke Teacher', role: 'teacher', scope: { institutionId: inst._id, collegeId: college._id, departmentId: dept._id } },
  ] as const;

  for (const p of people) {
    const user = await User.create({ name: p.name, email: `smoke-${p.key}${SMOKE_DOMAIN}`, passwordHash, status: 'active' });
    await RoleAssignment.create({ userId: user._id, role: p.role, scope: p.scope });
  }
  logger.info({ emails: people.map((p) => `smoke-${p.key}${SMOKE_DOMAIN}`) }, 'Smoke staff created');
}

if (require.main === module) {
  main()
    .catch((e) => { logger.fatal({ err: String(e?.message ?? e) }, 'Seed smoke staff failed'); process.exitCode = 1; })
    .finally(() => disconnectDb());
}
