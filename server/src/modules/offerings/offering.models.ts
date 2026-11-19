import { Schema, model } from 'mongoose';

const options = { timestamps: true } as const;
const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

/** A course being taught to one batch in one semester, with its teachers. */
const offeringSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    programId: ref('Program'),
    cohortId: ref('Cohort'),
    semesterId: ref('Semester'),
    courseId: ref('Course'),
    teacherIds: [ref('User')],
    /** Empty means every section. Used when a course is taught to some sections only. */
    sectionIds: [ref('Section')],
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
  },
  options,
);
offeringSchema.index({ semesterId: 1, courseId: 1 }, { unique: true });
offeringSchema.index({ cohortId: 1, semesterId: 1 });
offeringSchema.index({ teacherIds: 1, status: 1 });
export const CourseOffering = model('CourseOffering', offeringSchema);

/** Which student takes which offering. Created automatically; one per student per offering. */
const enrollmentSchema = new Schema(
  {
    profileId: ref('StudentProfile'),
    userId: ref('User'),
    offeringId: ref('CourseOffering'),
    courseId: ref('Course'),
    cohortId: ref('Cohort'),
    semesterId: ref('Semester'),
    source: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    status: { type: String, enum: ['active', 'dropped'], default: 'active' },
  },
  options,
);
enrollmentSchema.index({ profileId: 1, offeringId: 1 }, { unique: true });
enrollmentSchema.index({ offeringId: 1, status: 1 });
enrollmentSchema.index({ userId: 1, semesterId: 1 });
export const CourseEnrollment = model('CourseEnrollment', enrollmentSchema);
