import mongoose, { Types } from 'mongoose';
import type { Request } from 'express';
import type { Role } from '@rubayos/shared';
import { AppError } from '../../common/errors';
import { randomToken, sha256 } from '../../common/crypto';
import { appUrl, env } from '../../config/env';
import { sendMailSafe } from '../../integrations/email';
import { audit } from '../audit/audit.model';
import { Cohort, Department, Semester } from '../academic/academic.models';
import { RosterEntry, RegistrationRequest, StudentProfile } from '../students/student.models';
import { evaluateRosterMatch, normalizeName, normalizeRegNo } from '../students/nameMatch';
import { enrollOnJoin } from '../enrollment/enrollment.service';
import { PasswordReset, RefreshSession, RoleAssignment, User } from './auth.models';
import { dummyVerify, hashPassword, verifyPassword } from './password';
import { signAccessToken } from './tokens';
import type { RegisterInput } from './auth.schemas';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const REUSE_GRACE_MS = 10_000;
const FAMILY_MAX_DAYS = 90;
const day = 86_400_000;

export interface ReqMeta {
  ip?: string;
  userAgent?: string;
}
export const metaOf = (req: Request): ReqMeta => ({ ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 200) });

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

async function rolesOf(userId: unknown): Promise<Role[]> {
  const grants = await RoleAssignment.find({ userId, status: 'active' }).select('role').lean();
  return grants.map((g) => g.role as Role);
}

async function issueSession(
  user: { _id: unknown; rolesVersion: number },
  roles: Role[],
  meta: ReqMeta,
  family?: { id: string; startedAt: Date },
): Promise<IssuedSession> {
  const staff = roles.some((r) => r !== 'student');
  const ttlDays = staff ? env.REFRESH_TTL_DAYS_STAFF : env.REFRESH_TTL_DAYS_STUDENT;
  const refreshToken = randomToken(48);
  const refreshExpiresAt = new Date(Date.now() + ttlDays * day);
  const familyId = family?.id ?? randomToken(16);

  await RefreshSession.create({
    userId: user._id,
    tokenHash: sha256(refreshToken),
    familyId,
    familyStartedAt: family?.startedAt ?? new Date(),
    expiresAt: refreshExpiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  const accessToken = signAccessToken({ userId: String(user._id), familyId, rolesVersion: user.rolesVersion });
  return { accessToken, refreshToken, refreshExpiresAt };
}

const publicUser = (u: { _id: unknown; name: string; email: string; registrationNo?: string | null; status: string }) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  registrationNo: u.registrationNo ?? null,
  status: u.status,
});

// ---------------------------------------------------------------- registration

export type RegisterResult =
  | { status: 'active'; session: IssuedSession; user: ReturnType<typeof publicUser> }
  | { status: 'pending_approval' };

export async function registerStudent(input: RegisterInput, meta: ReqMeta, req?: Request): Promise<RegisterResult> {
  const dept = await Department.findById(input.departmentId).lean();
  if (!dept || dept.status !== 'active') throw AppError.badRequest('Department not found');

  const regNo = normalizeRegNo(input.registrationNo);
  const email = input.email.toLowerCase().trim();

  const roster = await RosterEntry.findOne({ institutionId: dept.institutionId, registrationNo: regNo });
  if (roster?.status === 'claimed') {
    throw AppError.conflict('An account already exists for this registration number. Try logging in or use Forgot password.');
  }

  const [byReg, byEmail] = await Promise.all([User.findOne({ registrationNo: regNo }), User.findOne({ email })]);
  if (byReg && byReg.status !== 'rejected') {
    throw AppError.conflict(
      byReg.status === 'pending_approval'
        ? 'Your registration is already waiting for admin approval.'
        : 'An account already exists for this registration number.',
    );
  }
  if (byEmail && (!byReg || !byEmail._id.equals(byReg._id))) throw AppError.conflict('This email is already used by another account.');

  const passwordHash = await hashPassword(input.password);
  const match = evaluateRosterMatch(
    roster ? { nameKey: roster.nameKey, classRoll: roster.classRoll, sameDepartment: roster.departmentId.equals(dept._id) } : null,
    { name: input.name, classRoll: input.classRoll },
  );

  const dbSession = await mongoose.startSession();
  try {
    const userId = byReg?._id ?? new Types.ObjectId();
    await dbSession.withTransaction(async () => {
      await User.updateOne(
        { _id: userId },
        {
          $set: {
            name: input.name.trim(),
            email,
            registrationNo: regNo,
            passwordHash,
            status: match.decision === 'auto' ? 'active' : 'pending_approval',
            passwordChangedAt: new Date(),
          },
          $setOnInsert: { rolesVersion: 0 },
        },
        { upsert: true, session: dbSession },
      );

      if (match.decision === 'auto' && roster) {
        const claim = await RosterEntry.updateOne(
          { _id: roster._id, status: 'unclaimed' },
          { $set: { status: 'claimed', claimedBy: userId } },
          { session: dbSession },
        );
        if (claim.modifiedCount !== 1) throw AppError.conflict('This registration number was just claimed by someone else.');
        await createStudentRecords(userId, roster, dbSession);
      } else {
        await RegistrationRequest.create(
          [
            {
              userId,
              institutionId: dept.institutionId,
              collegeId: dept.collegeId,
              departmentId: dept._id,
              cohortId: roster?.cohortId,
              rosterEntryId: roster?._id,
              submitted: { name: input.name.trim(), registrationNo: regNo, classRoll: input.classRoll },
              reasons: match.decision === 'pending' ? match.reasons : [],
            },
          ],
          { session: dbSession },
        );
      }
    });

    await audit({
      actorId: userId,
      action: match.decision === 'auto' ? 'student.register.auto' : 'student.register.pending',
      entityType: 'User',
      entityId: userId,
      meta: match.decision === 'pending' ? { reasons: match.reasons } : undefined,
      req,
    });

    if (match.decision === 'pending') return { status: 'pending_approval' };

    const user = await User.findById(userId);
    if (!user) throw AppError.notFound();
    const session = await issueSession(user, ['student'], meta);
    return { status: 'active', session, user: publicUser(user) };
  } finally {
    await dbSession.endSession();
  }
}

/** Creates the student profile and role for an approved roster entry. Used by auto-join and by admin approval. */
export async function createStudentRecords(
  userId: unknown,
  roster: { institutionId: unknown; collegeId: unknown; departmentId: unknown; cohortId: unknown; registrationNo: string; classRoll: number },
  session: mongoose.ClientSession,
): Promise<void> {
  const cohort = await Cohort.findById(String(roster.cohortId)).session(session);
  if (!cohort) throw AppError.badRequest('Cohort not found');
  const semester = await Semester.findOne({ cohortId: cohort._id, number: cohort.currentSemesterNo }).session(session);

  const [profile] = await StudentProfile.create(
    [
      {
        userId,
        institutionId: roster.institutionId,
        collegeId: roster.collegeId,
        departmentId: roster.departmentId,
        programId: cohort.programId,
        cohortId: cohort._id,
        currentSemesterId: semester?._id,
        registrationNo: roster.registrationNo,
        classRoll: roster.classRoll,
      },
    ],
    { session },
  );
  if (profile && semester) await enrollOnJoin(profile, semester, session);
  await RoleAssignment.create(
    [{ userId, role: 'student', scope: { institutionId: roster.institutionId, collegeId: roster.collegeId, departmentId: roster.departmentId, cohortId: cohort._id } }],
    { session },
  );
}

// ---------------------------------------------------------------- login / sessions

function findByIdentifier(identifier: string) {
  return identifier.includes('@')
    ? User.findOne({ email: identifier.toLowerCase().trim() })
    : User.findOne({ registrationNo: normalizeRegNo(identifier) });
}

export async function login(identifier: string, password: string, meta: ReqMeta, req?: Request) {
  const user = await findByIdentifier(identifier);
  if (!user) {
    await dummyVerify(password);
    throw AppError.unauthorized('Wrong ID or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong attempts. Please try again in a few minutes.');
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failed = user.failedLogins + 1;
    const locked = failed >= MAX_FAILED;
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLogins: locked ? 0 : failed, lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } },
    );
    await audit({ actorId: user._id, action: locked ? 'auth.locked' : 'auth.login.failed', entityType: 'User', entityId: user._id, req });
    throw AppError.unauthorized('Wrong ID or password');
  }

  // Status is revealed only after a correct password.
  if (user.status === 'pending_approval') throw new AppError(403, 'ACCOUNT_PENDING', 'Your registration is waiting for admin approval.');
  if (user.status === 'invited') throw new AppError(403, 'ACCOUNT_NOT_ACTIVATED', 'Please set your password using the link sent to your email.');
  if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is not active. Please contact your department.');

  await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const roles = await rolesOf(user._id);
  const session = await issueSession(user, roles, meta);
  await audit({ actorId: user._id, action: 'auth.login', entityType: 'User', entityId: user._id, req });
  return { session, user: publicUser(user), roles };
}

export async function refresh(rawToken: string | undefined, meta: ReqMeta, req?: Request): Promise<IssuedSession> {
  if (!rawToken) throw AppError.unauthorized();
  const old = await RefreshSession.findOne({ tokenHash: sha256(rawToken) });
  if (!old) throw AppError.unauthorized();

  if (old.revokedAt) {
    // A rotated token coming back later means it was copied: kill the whole login.
    if (old.revokedReason === 'rotated' && Date.now() - old.revokedAt.getTime() > REUSE_GRACE_MS) {
      await RefreshSession.updateMany({ familyId: old.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'reuse_detected' } });
      await audit({ actorId: old.userId, action: 'auth.refresh.reuse_detected', entityType: 'User', entityId: old.userId, req });
    }
    throw AppError.unauthorized();
  }
  if (old.expiresAt <= new Date() || Date.now() - old.familyStartedAt.getTime() > FAMILY_MAX_DAYS * day) throw AppError.unauthorized();

  const user = await User.findById(old.userId);
  if (!user || user.status !== 'active') throw AppError.unauthorized();

  const rotated = await RefreshSession.updateOne({ _id: old._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'rotated' } });
  if (rotated.modifiedCount !== 1) throw AppError.unauthorized();

  return issueSession(user, await rolesOf(user._id), meta, { id: old.familyId, startedAt: old.familyStartedAt });
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const s = await RefreshSession.findOne({ tokenHash: sha256(rawToken) });
  if (s) await RefreshSession.updateMany({ familyId: s.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } });
}

export async function revokeAllSessions(userId: unknown, reason: 'logout_all' | 'password_changed' | 'admin'): Promise<void> {
  await RefreshSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

// ---------------------------------------------------------------- password reset / invite

export async function createResetToken(userId: unknown, purpose: 'reset' | 'invite'): Promise<string> {
  await PasswordReset.deleteMany({ userId, usedAt: null });
  const raw = randomToken(32);
  const ttl = purpose === 'invite' ? 7 * day : 30 * 60_000;
  await PasswordReset.create({ userId, tokenHash: sha256(raw), purpose, expiresAt: new Date(Date.now() + ttl) });
  return raw;
}

/** Always succeeds from the caller's point of view, so it cannot be used to find out who has an account. */
export async function forgotPassword(identifier: string, req?: Request): Promise<void> {
  const user = await findByIdentifier(identifier);
  if (!user || !['active', 'invited'].includes(user.status)) return;
  const token = await createResetToken(user._id, 'reset');
  await sendMailSafe({
    to: user.email,
    subject: 'Reset your RubayOS password',
    text: `Hello ${user.name},\n\nUse this link to set a new password. It works once and expires in 30 minutes:\n${appUrl}/reset-password?token=${token}\n\nIf you did not ask for this, you can ignore this email.`,
  });
  await audit({ actorId: user._id, action: 'auth.password.forgot', entityType: 'User', entityId: user._id, req });
}

export async function resetPassword(rawToken: string, newPassword: string, req?: Request): Promise<void> {
  const reset = await PasswordReset.findOne({ tokenHash: sha256(rawToken), usedAt: null, expiresAt: { $gt: new Date() } });
  if (!reset) throw AppError.badRequest('This link is invalid or has expired. Please request a new one.');
  const user = await User.findById(reset.userId);
  if (!user) throw AppError.badRequest('This link is invalid or has expired. Please request a new one.');

  const used = await PasswordReset.updateOne({ _id: reset._id, usedAt: null }, { $set: { usedAt: new Date() } });
  if (used.modifiedCount !== 1) throw AppError.badRequest('This link was already used.');

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.failedLogins = 0;
  user.lockedUntil = null;
  if (user.status === 'invited') user.status = 'active';
  await user.save();

  await revokeAllSessions(user._id, 'password_changed');
  await audit({ actorId: user._id, action: reset.purpose === 'invite' ? 'auth.invite.accepted' : 'auth.password.reset', entityType: 'User', entityId: user._id, req });
  await sendMailSafe({
    to: user.email,
    subject: 'Your RubayOS password was changed',
    text: `Hello ${user.name},\n\nYour password was just changed. If this was not you, contact your department immediately.`,
  });
}

export async function changePassword(userId: string, current: string, next: string, req?: Request): Promise<void> {
  const user = await User.findById(userId);
  if (!user || !(await verifyPassword(user.passwordHash, current))) throw AppError.badRequest('Current password is incorrect');
  user.passwordHash = await hashPassword(next);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(user._id, 'password_changed');
  await audit({ actorId: user._id, action: 'auth.password.changed', entityType: 'User', entityId: user._id, req });
  await sendMailSafe({ to: user.email, subject: 'Your RubayOS password was changed', text: `Hello ${user.name},\n\nYour password was just changed. If this was not you, contact your department immediately.` });
}

export async function currentUser(userId: string) {
  const [user, roles, profile] = await Promise.all([
    User.findById(userId).lean(),
    RoleAssignment.find({ userId, status: 'active' }).select('role scope').lean(),
    StudentProfile.findOne({ userId }).lean(),
  ]);
  if (!user) throw AppError.unauthorized();
  return {
    user: publicUser(user),
    roles: roles.map((r) => ({ role: r.role, scope: r.scope })),
    profile: profile
      ? {
          institutionId: profile.institutionId,
          collegeId: profile.collegeId,
          departmentId: profile.departmentId,
          programId: profile.programId,
          cohortId: profile.cohortId,
          currentSemesterId: profile.currentSemesterId ?? null,
          sectionId: profile.sectionId ?? null,
          partId: profile.partId ?? null,
          classRoll: profile.classRoll,
        }
      : null,
  };
}

export { normalizeName };
