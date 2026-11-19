import { Schema, model } from 'mongoose';

const ref = (to: string, required = true) => ({ type: Schema.Types.ObjectId, ref: to, required });

/** One exam of one course for one batch. The date is kept as "YYYY-MM-DD" so time zones can never shift it. */
const examSchema = new Schema(
  {
    institutionId: ref('Institution'),
    collegeId: ref('College'),
    departmentId: ref('Department'),
    cohortId: ref('Cohort'),
    semesterId: ref('Semester'),
    offeringId: ref('CourseOffering'),
    title: { type: String, default: 'Exam', trim: true },
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    room: { type: String, default: '', trim: true },
    instructions: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'published', 'cancelled'], default: 'draft' },
    publishedAt: { type: Date, default: null },
    publishedBy: ref('User', false),
  },
  { timestamps: true },
);
examSchema.index({ semesterId: 1, date: 1, startTime: 1 });
examSchema.index({ offeringId: 1 });
examSchema.index({ institutionId: 1, status: 1, date: 1 });
export const ExamEvent = model('ExamEvent', examSchema);
