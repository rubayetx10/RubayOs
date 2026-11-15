import { Schema, model } from 'mongoose';
import { ROLES } from '@rubayos/shared';

const options = { timestamps: true } as const;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true },
    registrationNo: { type: String, trim: true, unique: true, sparse: true },
    status: {
      type: String,
      enum: ['active', 'pending_approval', 'invited', 'rejected', 'deactivated'],
      default: 'active',
    },
    rolesVersion: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      language: { type: String, enum: ['en', 'bn'], default: 'en' },
    },
    deletedAt: { type: Date, default: null },
  },
  options,
);
export const User = model('User', userSchema);

const roleAssignmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: [...ROLES], required: true },
    scope: {
      institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', default: null },
      collegeId: { type: Schema.Types.ObjectId, ref: 'College', default: null },
      departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
      cohortId: { type: Schema.Types.ObjectId, ref: 'Cohort', default: null },
    },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  options,
);
roleAssignmentSchema.index({ userId: 1, status: 1 });
roleAssignmentSchema.index({ 'scope.collegeId': 1, role: 1 });
roleAssignmentSchema.index({ 'scope.departmentId': 1, role: 1 });
export const RoleAssignment = model('RoleAssignment', roleAssignmentSchema);

const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true },
    familyStartedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: ['rotated', 'logout', 'logout_all', 'reuse_detected', 'password_changed', 'admin', null], default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  options,
);
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshSessionSchema.index({ familyId: 1 });
refreshSessionSchema.index({ userId: 1 });
export const RefreshSession = model('RefreshSession', refreshSessionSchema);

const passwordResetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    purpose: { type: String, enum: ['reset', 'invite'], default: 'reset' },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  options,
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
passwordResetSchema.index({ userId: 1 });
export const PasswordReset = model('PasswordReset', passwordResetSchema);
