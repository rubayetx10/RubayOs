import { Schema, model } from 'mongoose';

const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

/**
 * A notice and who it is for. Students are matched at read time from their own batch, semester, section
 * and enrolled courses, so a notice is stored once, never copied per student.
 */
const noticeSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department', false),
    publisherId: ref('User'),
    publisherRole: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    priority: { type: String, enum: ['normal', 'important', 'urgent'], default: 'normal' },
    pinned: { type: Boolean, default: false },
    target: {
      scope: { type: String, enum: ['college', 'department', 'cohort', 'course'], required: true },
      collegeId: ref('College', false),
      departmentId: ref('Department', false),
      cohortId: ref('Cohort', false),
      semesterId: ref('Semester', false),
      sectionIds: { type: [Schema.Types.ObjectId], default: [] },
      offeringId: ref('CourseOffering', false),
    },
    publishAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'withdrawn'], default: 'active' },
    withdrawal: { by: ref('User', false), at: { type: Date, default: null }, reason: { type: String, default: null } },
    editHistory: { type: [new Schema({ at: Date, by: Schema.Types.ObjectId, title: String, body: String }, { _id: false })], default: [] },
  },
  { timestamps: true },
);
noticeSchema.index({ 'target.cohortId': 1, status: 1, publishAt: -1 });
noticeSchema.index({ 'target.offeringId': 1, status: 1, publishAt: -1 });
noticeSchema.index({ 'target.departmentId': 1, status: 1, publishAt: -1 });
noticeSchema.index({ 'target.collegeId': 1, status: 1, publishAt: -1 });
noticeSchema.index({ publisherId: 1, createdAt: -1 });
export const Notice = model('Notice', noticeSchema);

const readSchema = new Schema({ noticeId: ref('Notice'), userId: ref('User'), readAt: { type: Date, default: Date.now } }, { versionKey: false });
readSchema.index({ noticeId: 1, userId: 1 }, { unique: true });
readSchema.index({ userId: 1 });
export const NoticeRead = model('NoticeRead', readSchema);
