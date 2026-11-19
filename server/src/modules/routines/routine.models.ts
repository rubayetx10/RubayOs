import { Schema, model } from 'mongoose';

const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

const entrySchema = new Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    offeringId: ref('CourseOffering'),
    teacherId: ref('User', false),
    room: { type: String, default: '' },
  },
  { _id: false },
);

/**
 * One version of one section's weekly routine. A section has at most one draft (being edited) and one
 * published version (what students see). Older published versions are kept as "superseded".
 */
const versionSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    cohortId: ref('Cohort'),
    semesterId: ref('Semester'),
    sectionId: ref('Section'),
    versionNo: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'published', 'superseded'], default: 'draft' },
    entries: { type: [entrySchema], default: [] },
    changelog: { type: [String], default: [] },
    effectiveDate: { type: Date, default: null },
    publishedBy: ref('User', false),
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
versionSchema.index({ semesterId: 1, sectionId: 1, status: 1 });
versionSchema.index({ semesterId: 1, sectionId: 1 }, { unique: true, partialFilterExpression: { status: 'draft' }, name: 'one_draft' });
versionSchema.index({ semesterId: 1, sectionId: 1 }, { unique: true, partialFilterExpression: { status: 'published' }, name: 'one_published' });
export const RoutineVersion = model('RoutineVersion', versionSchema);
