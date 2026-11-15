import { Schema, model } from 'mongoose';

const options = { timestamps: true } as const;
const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

/**
 * One row per student per semester. Moving to the next semester adds a row and closes the old one,
 * so a student's section, part and roll in every past semester stays on record.
 */
const enrollmentSchema = new Schema(
  {
    profileId: ref('StudentProfile'),
    userId: ref('User'),
    cohortId: ref('Cohort'),
    semesterId: ref('Semester'),
    sectionId: ref('Section', false),
    partId: ref('Part', false),
    classRoll: { type: Number, required: true },
    assignedBy: { type: String, enum: ['auto', 'manual', 'none'], default: 'none' },
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
  },
  options,
);
enrollmentSchema.index({ profileId: 1, semesterId: 1 }, { unique: true });
enrollmentSchema.index({ semesterId: 1, sectionId: 1, partId: 1 });
enrollmentSchema.index({ cohortId: 1, semesterId: 1, status: 1 });
export const SemesterEnrollment = model('SemesterEnrollment', enrollmentSchema);

const historySchema = new Schema(
  {
    profileId: ref('StudentProfile'),
    userId: ref('User'),
    cohortId: ref('Cohort'),
    semesterId: ref('Semester'),
    from: { sectionId: ref('Section', false), partId: ref('Part', false) },
    to: { sectionId: ref('Section', false), partId: ref('Part', false) },
    method: { type: String, enum: ['auto', 'manual', 'promotion'], required: true },
    reason: { type: String, default: null },
    actorId: ref('User', false),
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
historySchema.index({ profileId: 1, at: -1 });
historySchema.index({ cohortId: 1, semesterId: 1, at: -1 });
export const AssignmentHistory = model('AssignmentHistory', historySchema);
