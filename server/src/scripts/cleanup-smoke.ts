import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../config/logger';
import { AcademicSession, Cohort, College, Department, Part, Section, Semester } from '../modules/academic/academic.models';
import { AssignmentHistory, SemesterEnrollment } from '../modules/enrollment/enrollment.models';
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

/** Removes the "SMOKE-1" session, its cohort and everything under it, created by the Step 1.5 smoke test. */
export async function removeSmokeCohort() {
  const sessions = await AcademicSession.find({ label: 'SMOKE-1' }).select('_id').lean();
  const cohorts = await Cohort.find({ sessionId: { $in: sessions.map((x) => x._id) } }).select('_id').lean();
  const ids = cohorts.map((c) => c._id);
  return {
    history: (await AssignmentHistory.deleteMany({ cohortId: { $in: ids } })).deletedCount,
    enrollments: (await SemesterEnrollment.deleteMany({ cohortId: { $in: ids } })).deletedCount,
    parts: (await Part.deleteMany({ cohortId: { $in: ids } })).deletedCount,
    sections: (await Section.deleteMany({ cohortId: { $in: ids } })).deletedCount,
    semesters: (await Semester.deleteMany({ cohortId: { $in: ids } })).deletedCount,
    cohorts: (await Cohort.deleteMany({ _id: { $in: ids } })).deletedCount,
    sessions: (await AcademicSession.deleteMany({ label: 'SMOKE-1' })).deletedCount,
  };
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
  // Students first (their profiles point at the cohort), then the cohort, then the fake staff.
  const cohort = await removeSmokeCohort();
  logger.info({ students, cohort, staff: await removeSmokeStaff() }, 'Smoke-test data removed');
}

if (require.main === module) {
  main()
    .catch((e) => { logger.fatal({ err: String(e) }, 'Cleanup failed'); process.exitCode = 1; })
    .finally(() => disconnectDb());
}
