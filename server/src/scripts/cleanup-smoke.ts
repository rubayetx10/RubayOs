import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../config/logger';
import { College, Department } from '../modules/academic/academic.models';
import { PasswordReset, RefreshSession, RoleAssignment, User } from '../modules/auth/auth.models';
import { RegistrationRequest, RosterEntry, StudentProfile } from '../modules/students/student.models';

const SMOKE_EMAIL = /@smoke\.rubayos\.test$/;

/** Removes the fake staff, "Smoke College B" and its department created for the Step 1.4 smoke test. */
export async function removeSmokeStaff() {
  const users = await User.find({ email: SMOKE_EMAIL }).select('_id').lean();
  const ids = users.map((u) => u._id);
  const out = {
    sessions: (await RefreshSession.deleteMany({ userId: { $in: ids } })).deletedCount,
    resets: (await PasswordReset.deleteMany({ userId: { $in: ids } })).deletedCount,
    roles: (await RoleAssignment.deleteMany({ userId: { $in: ids } })).deletedCount,
    users: (await User.deleteMany({ _id: { $in: ids } })).deletedCount,
    departments: (await Department.deleteMany({ code: 'SMOKEDB' })).deletedCount,
    colleges: (await College.deleteMany({ code: 'SMOKEB' })).deletedCount,
  };
  return out;
}

/** Removes the fake students from the Step 1.3 smoke test (registration numbers 90000000xx) and the Step 1.4 fake staff. */
async function main() {
  await connectDb();
  const regs = /^90000000\d{2}$/;
  const users = await User.find({ registrationNo: regs }).select('_id').lean();
  const ids = users.map((u) => u._id);
  const students = {
    sessions: (await RefreshSession.deleteMany({ userId: { $in: ids } })).deletedCount,
    roles: (await RoleAssignment.deleteMany({ userId: { $in: ids } })).deletedCount,
    profiles: (await StudentProfile.deleteMany({ registrationNo: regs })).deletedCount,
    requests: (await RegistrationRequest.deleteMany({ 'submitted.registrationNo': regs })).deletedCount,
    roster: (await RosterEntry.deleteMany({ registrationNo: regs })).deletedCount,
    users: (await User.deleteMany({ _id: { $in: ids } })).deletedCount,
  };
  logger.info({ students, staff: await removeSmokeStaff() }, 'Smoke-test data removed');
}

if (require.main === module) {
  main()
    .catch((e) => { logger.fatal({ err: String(e) }, 'Cleanup failed'); process.exitCode = 1; })
    .finally(() => disconnectDb());
}
